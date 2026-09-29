"""Регионы обслуживания (справочник)."""
from __future__ import annotations

from typing import Any

REGIONS: dict[str, dict[str, Any]] = {
    "east": {
        "region_id": "east",
        "name": "Восток",
        "office": {
            "address": "г. Москва, ул. Юных Ленинцев, д. 83с4",
            "lat": 55.6995,
            "lon": 37.7590,
        },
        "engineer_count": 12,
        "request_count": 66,
        "dispatcher_assignments": 64,
        "has_control": True,
        "demo_available": True,
        "car_requests": 7,
    },
    "south_east": {
        "region_id": "south_east",
        "name": "Юго-восток",
        "office": {
            "address": "г. Москва, ул. Бирюлёвская, д. 1с1",
            "lat": 55.5800,
            "lon": 37.6600,
        },
        "engineer_count": 12,
        "request_count": 83,
        "dispatcher_assignments": 83,
        "has_control": True,
        "demo_available": True,
        "car_requests": 15,
    },
    "south_center": {
        "region_id": "south_center",
        "name": "Югоцентр",
        "office": {
            "address": "г. Москва, Симферопольский пр., д. 7",
            "lat": 55.6600,
            "lon": 37.6100,
        },
        "engineer_count": 11,
        "request_count": 56,
        "dispatcher_assignments": 56,
        "has_control": True,
        "demo_available": True,
        "car_requests": 2,
    },
}

DEFAULT_REGION_ID = "east"

#: Нормативы оператора связи: тип заявки BK → навык и длительность работ (у участков кейса).
BEELINE_NORMS: dict[str, Any] = {
    "types": [
        {"type_bk": "Подключение", "skill": "installation", "duration_minutes": 70},
        {"type_bk": "Дозаказ", "skill": "installation", "duration_minutes": 20},
        {"type_bk": "Локальная заявка", "skill": "local", "duration_minutes": 30},
        {"type_bk": "Глобальная проблема", "skill": "emergency", "duration_minutes": 80},
    ]
}

for _region in REGIONS.values():
    _region.setdefault("builtin", True)
    _region.setdefault("norms", BEELINE_NORMS)
    _region.setdefault("created_at", None)


def is_builtin(region_id: str | None) -> bool:
    """Участок кейса (east / south_east / south_center)."""
    return bool(region_id) and region_id.strip().lower() in REGIONS


def region_from_record(record) -> dict[str, Any]:
    """Свой участок (§14) в той же форме, что участки кейса."""
    roster = list(record.roster or [])
    return {
        "region_id": record.id,
        "name": record.name,
        "office": {"address": record.office_address, "lat": record.office_lat, "lon": record.office_lon},
        "engineer_count": len(roster),
        "request_count": int(record.request_count or 0),
        "dispatcher_assignments": 0,
        "has_control": bool(record.has_control),
        "demo_available": False,
        "car_requests": 0,
        "builtin": False,
        "norms": record.norms or {"types": []},
        "roster": roster,
        "created_at": record.created_at.isoformat() if record.created_at else None,
    }


def _with_repository(action):
    """Своя сессия, если вызывающий код её не передал."""
    from app.storage.database import SessionLocal
    from app.storage.repository import Repository

    session = SessionLocal()
    try:
        return action(Repository(session))
    finally:
        session.close()


def get_region(region_id: str | None, repository=None) -> dict[str, Any] | None:
    """Участок по ID: кейса или свой (§14); иначе ``None``."""
    if not region_id:
        return None
    builtin = REGIONS.get(region_id.strip().lower())
    if builtin is not None:
        return builtin

    def load(repo):
        record = repo.get_region_record(region_id.strip())
        return region_from_record(record) if record is not None else None

    return load(repository) if repository is not None else _with_repository(load)


def norm_for(region: dict[str, Any] | None, type_bk: str | None) -> tuple[str, int] | None:
    """Норматив участка по типу BK (без учёта регистра); нет — ``None``."""
    key = (type_bk or "").strip().lower().replace("ё", "е")
    for item in ((region or {}).get("norms") or {}).get("types", []):
        if str(item.get("type_bk", "")).strip().lower().replace("ё", "е") == key:
            return item["skill"], int(item["duration_minutes"])
    return None


def detect_region_by_office(address: str | None) -> dict[str, Any] | None:
    """Определяет регион по адресу офиса (грубое сопоставление по ключевым словам)."""
    if not address:
        return None
    lowered = address.lower()
    keywords = {
        "east": ["ленинцев", "восток"],
        "south_east": ["бирюлёв", "бирюлев", "юго-восток"],
        "south_center": ["симферополь", "югоцентр", "юго-центр"],
    }
    for region_id, words in keywords.items():
        if any(word in lowered for word in words):
            return REGIONS[region_id]
    return None


def list_regions(repository=None) -> list[dict[str, Any]]:
    """Участки кейса, затем свои (§14) в порядке создания."""

    def load(repo):
        return [region_from_record(record) for record in repo.list_region_records()]

    custom = load(repository) if repository is not None else _with_repository(load)
    return [dict(region) for region in REGIONS.values()] + custom


def build_region_roster(region: dict[str, Any]) -> list[dict[str, Any]]:
    """Ростер участка: у участка кейса — бригады демо-набора, у своего — сохранённый (§14)."""
    if region.get("builtin", True):
        from app.services.region_dataset import build_region_scenario

        return build_region_scenario(region["region_id"])["engineers"]
    return [dict(item) for item in region.get("roster") or []]


def rule_roster(region: dict[str, Any], request_count: int, shift: tuple[str, str]) -> list[dict[str, Any]]:
    """Ростер по правилу (§14): бригада на 5–6 заявок, не меньше трёх; аварийные — у каждой 4-й."""
    import math

    count = max(3, math.ceil(request_count / 5.5))
    office = region["office"]
    return [
        {
            "id": f"E{index + 1:02d}",
            "name": f"Бригада {index + 1}",
            "latitude": office["lat"],
            "longitude": office["lon"],
            "shift_start": shift[0],
            "shift_end": shift[1],
            "skills": ["local", "installation", "emergency"] if index % 4 == 0 else ["local", "installation"],
            "transport": "car",
            "available": True,
            "start_kind": "office",
        }
        for index in range(count)
    ]

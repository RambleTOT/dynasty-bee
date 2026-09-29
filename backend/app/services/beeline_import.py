"""Адаптер выданных CSV Билайна (``POST /data/import-beeline``)."""
from __future__ import annotations

import csv
import hashlib
import io
import re
from datetime import datetime
from typing import Any

from app.core.constants import (
    CAR_RULE_HD,
    SKILL_ALIASES,
    SKILL_EMERGENCY,
    SKILL_INSTALLATION,
    SKILL_LOCAL,
    TRANSPORT_ALIASES,
    car_by_rule,
)
from app.core.regions import (
    DEFAULT_REGION_ID,
    REGIONS,
    build_region_roster,
    detect_region_by_office,
    get_region,
    norm_for,
    rule_roster,
)
from app.services.region_dataset import DEFAULT_DATE, SHIFT_END, SHIFT_START, build_region_scenario

#: Норматив длительности (без дороги) по типу заявки BK.
_DURATION_BY_TYPE = {
    "подключение": 70,
    "глобальная проблема": 80,
    "дозаказ": 20,
    "локальная заявка": 30,
}

_SKILL_BY_TYPE = {
    "подключение": SKILL_INSTALLATION,
    "дозаказ": SKILL_INSTALLATION,
    "локальная заявка": SKILL_LOCAL,
    "глобальная проблема": SKILL_EMERGENCY,
}

_BK_ALIASES = {
    "подключение": "Подключение",
    "дозаказ": "Дозаказ",
    "локальная заявка": "Локальная заявка",
    "глобальная проблема": "Глобальная проблема",
}


class ImportError_(ValueError):
    """Ошибка импорта CSV (код и сообщение для API)."""

    def __init__(self, code: str, message: str, details: dict | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.details = details or {}


def _decode(content: bytes) -> str:
    for encoding in ("utf-8-sig", "cp1251"):
        try:
            return content.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise ImportError_("BAD_CSV", "Не удалось определить кодировку (ожидается UTF-8 или cp1251)")


def _prepare_rows(content: bytes) -> tuple[list[dict[str, str]], str | None]:
    """Разбирает CSV и вырезает хвостовую строку с адресом офиса."""
    text = _decode(content).replace("\r\n", "\n").replace("\r", "\n")
    lines = text.split("\n")
    office_address: str | None = None
    while lines and not lines[-1].strip():
        lines.pop()
    if lines and "адрес офиса" in lines[-1].strip().lower():
        office_address = lines[-1].split(";", 1)[1] if ";" in lines[-1] else None
        if office_address is not None:
            # В контрольном CSV после адреса идут пустые колонки: «;;;;;;».
            office_address = office_address.rstrip(";").strip() or None
        lines.pop()
    while lines and not lines[-1].strip():
        lines.pop()
    if not lines:
        raise ImportError_("BAD_CSV", "Пустой CSV")
    reader = csv.DictReader(io.StringIO("\n".join(lines)), delimiter=";")
    if not reader.fieldnames:
        raise ImportError_("BAD_CSV", "Не найдены заголовки CSV")
    rows = [{ (k or "").strip(): (v or "").strip() for k, v in row.items()} for row in reader]
    rows = [row for row in rows if any(row.values())]
    _require_columns(reader.fieldnames)
    return rows, office_address


def _require_columns(fieldnames: list[str]) -> None:
    normalized = [name.strip().lower() for name in fieldnames]
    required = ["заявка", "тип заявки bk", "начало", "окончание", "адрес"]
    missing = [name for name in required if name not in normalized]
    if missing:
        raise ImportError_(
            "BAD_CSV",
            f"Нет обязательных колонок: {missing}",
            {"found": [name.strip() for name in fieldnames]},
        )


def _get(row: dict[str, str], *names: str) -> str | None:
    for name in names:
        for key, value in row.items():
            if key.strip().lower() == name.lower() and value:
                return value
    return None


def _parse_bool(value: str | None) -> bool:
    if not value:
        return False
    return value.strip().lower() in {"да", "true", "1", "yes", "y"}


def _parse_window(
    start_raw: str | None, end_raw: str | None, shift_start: str = SHIFT_START, shift_end: str = SHIFT_END
) -> tuple[str, str]:
    def norm(value: str | None, default: str) -> str:
        if not value:
            return default
        match = re.search(r"(\d{1,2}):(\d{2})", value)
        if not match:
            return default
        return f"{int(match.group(1)):02d}:{match.group(2)}"

    start = norm(start_raw, shift_start)
    end = norm(end_raw, shift_end)
    if start == "00:01" and end == "23:59":
        return shift_start, shift_end
    return start, end


def _parse_date(value: str | None) -> str:
    if not value:
        return DEFAULT_DATE
    match = re.search(r"(\d{1,2})\.(\d{1,2})\.(\d{4})", value)
    if match:
        day, month, year = match.groups()
        return f"{year}-{int(month):02d}-{int(day):02d}"
    match = re.search(r"(\d{4})-(\d{2})-(\d{2})", value)
    if match:
        return value
    return DEFAULT_DATE


def _geocode(address: str, office: dict[str, Any]) -> tuple[float, float]:
    digest = hashlib.sha256(address.strip().lower().encode("utf-8")).digest()
    lat = office["lat"] + (int.from_bytes(digest[:4], "big") / 2**32 - 0.5) * 0.12
    lon = office["lon"] + (int.from_bytes(digest[4:8], "big") / 2**32 - 0.5) * 0.16
    return round(lat, 6), round(lon, 6)


def _required_transport(row: dict[str, str], type_hd: str) -> tuple[str | None, str]:
    """Колонка «Требуемый транспорт», иначе правило D-06 (D-40): кабель или авария → автомобиль."""
    explicit = _get(row, "Требуемый транспорт", "требуемый транспорт")
    if explicit:
        key = explicit.strip().lower()
        if key in TRANSPORT_ALIASES:
            return TRANSPORT_ALIASES[key], "column"
        return None, "column"
    if car_by_rule(type_hd):
        return "car", "rule"
    return None, "rule"


def _engineers_from_control(rows: list[dict[str, str]], base: list[dict]) -> list[dict]:
    """Бригады по колонке «Бригада»: знакомые по имени — из ростера участка, остальные — по шаблону."""
    brigades: list[str] = []
    for row in rows:
        brigade = _get(row, "Бригада")
        if brigade and brigade not in brigades:
            brigades.append(brigade)
    by_name = {engineer["name"]: engineer for engineer in base}
    used = {engineer["id"] for engineer in base if engineer["name"] in brigades}
    engineers: list[dict] = []
    next_id = 1
    for index, name in enumerate(brigades):
        if name in by_name:
            engineers.append(by_name[name])
            continue
        template = base[index % len(base)].copy()
        template["name"] = name
        while f"E{next_id:02d}" in used:
            next_id += 1
        template["id"] = f"E{next_id:02d}"
        used.add(template["id"])
        engineers.append(template)
    return engineers or base


def _row_skill(row: dict[str, str]) -> str | None:
    """Колонка «Навык» (§14): ключ или русское название навыка."""
    raw = _get(row, "Навык")
    return SKILL_ALIASES.get(raw.strip().lower()) if raw else None


def _row_duration(row: dict[str, str]) -> int | None:
    """Колонка «Длительность» (§14): минуты работы без дороги, 5–480."""
    raw = _get(row, "Длительность")
    try:
        value = round(float(raw.replace(",", "."))) if raw else None
    except ValueError:
        return None
    return value if value is not None and 5 <= value <= 480 else None


def _row_point(row: dict[str, str]) -> tuple[float, float] | None:
    """Колонки «Широта» и «Долгота» (§14): точка из загрузки, геокодер не нужен."""
    try:
        lat = float((_get(row, "Широта") or "").replace(",", "."))
        lon = float((_get(row, "Долгота") or "").replace(",", "."))
    except ValueError:
        return None
    return (round(lat, 6), round(lon, 6)) if -90 <= lat <= 90 and -180 <= lon <= 180 else None


def _parse_engineers_file(content: bytes) -> list[dict]:
    text = _decode(content).replace("\r\n", "\n")
    reader = csv.DictReader(io.StringIO(text))
    engineers: list[dict] = []
    for row in reader:
        row = {(k or "").strip(): (v or "").strip() for k, v in row.items()}
        if not row.get("id"):
            continue
        skills = [
            item.strip()
            for item in re.split(r"[;|,]", row.get("skills", "") or "")
            if item.strip()
        ]
        engineers.append(
            {
                "id": row["id"],
                "name": row.get("name") or row["id"],
                "latitude": float(row.get("latitude") or 55.75),
                "longitude": float(row.get("longitude") or 37.62),
                "shift_start": row.get("shift_start") or SHIFT_START,
                "shift_end": row.get("shift_end") or SHIFT_END,
                "skills": skills or [SKILL_LOCAL],
                "transport": row.get("transport") or "car",
                "available": (row.get("available", "true").lower() != "false"),
                "start_kind": "office",
            }
        )
    return engineers


def import_beeline(
    requests_content: bytes,
    *,
    control_content: bytes | None = None,
    engineers_content: bytes | None = None,
    region_id: str | None = None,
    date: str | None = None,
    geocoder=None,
    region: dict | None = None,
) -> tuple[dict, dict]:
    """Разбирает CSV Билайна и возвращает (scenario, import_report).

    ``geocoder`` — необязательный :class:`app.services.geocoder.Geocoder` с кэшем
    в БД. Если он настроен (yandex/nominatim) и адрес не найден — координаты
    берутся из офиса, адрес попадает в ``geocode_fallback``.
    """
    from app.core.config import get_settings

    settings = get_settings()
    request_rows, office_address = _prepare_rows(requests_content)
    control_rows: list[dict[str, str]] = []
    if control_content:
        control_rows, control_office = _prepare_rows(control_content)
        office_address = office_address or control_office
        if control_rows and len(control_rows) != len(request_rows):
            raise ImportError_(
                "ROWS_MISMATCH",
                "Контрольный файл и синтетика разной длины",
                {"requests": len(request_rows), "control": len(control_rows)},
            )

    region = region or get_region(region_id) or detect_region_by_office(office_address)
    if region is None:
        raise ImportError_(
            "REGION_UNKNOWN",
            "Не удалось определить регион: передайте region_id",
            {"office_address": office_address},
        )
    region_id = region["region_id"]
    custom = not region.get("builtin", True)
    office = region["office"]
    if office_address and not custom:
        office = {**office, "address": office_address}

    date = date or _parse_date(_get(request_rows[0], "Начало") if request_rows else None)

    # Ростер: файл бригад → «Бригада» контрольного файла → ростер участка → правило (§14)
    base = build_region_roster(region) or rule_roster(region, len(request_rows), (SHIFT_START, SHIFT_END))
    if engineers_content:
        engineers, engineers_source = _parse_engineers_file(engineers_content), "file"
        for engineer in engineers:
            if custom and (engineer["latitude"], engineer["longitude"]) == (55.75, 37.62):
                engineer["latitude"], engineer["longitude"] = office["lat"], office["lon"]
    elif control_rows:
        engineers, engineers_source = _engineers_from_control(control_rows, base), "control"
    elif custom and not region.get("roster"):
        engineers, engineers_source = base, "rule"
    else:
        engineers, engineers_source = base, "region"
    engineer_id_by_name = {engineer["name"]: engineer["id"] for engineer in engineers}

    requests: list[dict] = []
    transport_by_rule = 0
    geocode_fallback: list[str] = []
    geocoded = 0
    coords_from_file = 0
    unknown_types: dict[str, int] = {}
    skipped: list[dict] = []
    configured_geocoder = geocoder is not None and geocoder.provider != "none"
    for index, row in enumerate(request_rows):
        type_bk_raw = (_get(row, "Тип заявки BK") or "").strip()
        type_bk = _BK_ALIASES.get(type_bk_raw.lower(), type_bk_raw or "Локальная заявка")
        type_hd = (_get(row, "Тип заявки HD") or "").strip()
        # Навык и длительность: колонки строки (§14) → нормативы участка → по умолчанию
        norm = norm_for(region, type_bk) if custom else (
            (_SKILL_BY_TYPE[type_bk.lower()], _DURATION_BY_TYPE[type_bk.lower()])
            if type_bk.lower() in _SKILL_BY_TYPE
            else None
        )
        row_skill, row_duration = _row_skill(row), _row_duration(row)
        if norm is None and (row_skill is None or row_duration is None):
            unknown_types[type_bk] = unknown_types.get(type_bk, 0) + 1
        skill = row_skill or (norm[0] if norm else SKILL_LOCAL)
        duration = row_duration or (norm[1] if norm else 30)
        window_start, window_end = _parse_window(_get(row, "Начало"), _get(row, "Окончание"))
        gigabit = _parse_bool(_get(row, "Гигабитное подключение"))
        required_transport, transport_source = _required_transport(row, type_hd)
        if transport_source == "rule" and required_transport:
            transport_by_rule += 1
        address = _get(row, "Адрес") or ""
        lat: float | None = None
        lon: float | None = None
        point = _row_point(row)
        if point is not None:
            lat, lon = point
            coords_from_file += 1
        elif configured_geocoder:
            coords = geocoder.geocode(address)
            if coords is not None:
                lat, lon = coords
                geocoded += 1
            else:
                geocode_fallback.append(address)
                lat, lon = office["lat"], office["lon"]
        elif settings.allow_demo_geocoding and not custom:
            # демо-геокодинг — только участкам кейса: у своего участка точки «вокруг офиса» выдуманы
            try:
                lat, lon = _geocode(address, office)
                geocoded += 1
            except Exception:  # noqa: BLE001
                geocode_fallback.append(address)
                lat, lon = office["lat"], office["lon"]
        else:
            geocode_fallback.append(address)
            lat, lon = office["lat"], office["lon"]
        control = control_rows[index] if index < len(control_rows) else {}
        brigade_name = _get(control, "Бригада") if control else None
        dispatcher = engineer_id_by_name.get(brigade_name) if brigade_name else None
        external_id = _get(control, "Заявка") if control else None
        requests.append(
            {
                "id": _get(row, "Заявка") or f"R{index + 1:04d}",
                "external_id": external_id,
                "latitude": lat,
                "longitude": lon,
                "address": address,
                "district": (_get(row, "Район") or "").replace("GPON ", "").replace(" - ", "-"),
                "type_bk": type_bk,
                "type_hd": type_hd,
                "gigabit": gigabit,
                "technology": _get(row, "Подключение"),
                "duration_minutes": duration,
                "window_start": window_start,
                "window_end": window_end,
                "priority": "urgent" if skill == SKILL_EMERGENCY else "normal",
                "priority_rank": 1 if skill == SKILL_EMERGENCY else (2 if skill == SKILL_INSTALLATION else 3),
                "required_skill": skill,
                "required_transport": required_transport,
                "release_time": 0,
                "source": "csv",
                "dispatcher_engineer_id": dispatcher,
                "assigned_engineer": dispatcher,
                "client_window_locked": False,
            }
        )

    dispatcher_loaded = sum(1 for row in requests if row.get("dispatcher_engineer_id"))
    without_brigade = len(requests) - dispatcher_loaded
    car_total = sum(1 for row in requests if row.get("required_transport") == "car")
    warnings: list[str] = []
    if not control_rows:
        warnings.append("Контрольный файл не загружен: в колонке «Реальный диспетчер» будет «нет данных»")
    elif without_brigade:
        warnings.append(f"{without_brigade} заявок без бригады в контрольном файле")

    report = {
        "region_id": region_id,
        "region_name": region["name"],
        "coords_from_file": coords_from_file,
        "unknown_types": [{"type_bk": name, "count": count} for name, count in unknown_types.items()],
        "engineers_source": engineers_source,
        "rows_total": len(request_rows),
        "rows_loaded": len(requests),
        "rows_skipped": skipped,
        "office": office,
        "geocoded": geocoded,
        "geocoder": geocoder.provider if geocoder is not None else ("demo" if settings.allow_demo_geocoding else "none"),
        "geocoded_from_cache": geocoded,
        "geocode_fallback": geocode_fallback,
        "required_transport": {
            "source": "column+rule",
            "car": car_total,
            "car_by_rule": transport_by_rule,
            "rule": list(CAR_RULE_HD),
        },
        "dispatcher_assignments_loaded": dispatcher_loaded,
        "warnings": warnings,
    }
    scenario = {
        "name": f"{region['name']} · {date} · CSV",
        "description": f"Импорт CSV Билайна, регион {region['name']}",
        "engineers": engineers,
        "requests": requests,
        "scenario_metadata": {
            "region_id": region_id,
            "date": date,
            "source": "csv",
            "office": office,
        },
    }
    return scenario, report

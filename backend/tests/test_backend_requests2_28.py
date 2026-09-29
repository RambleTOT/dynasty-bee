"""Тесты правок из docs/BACKEND_REQUESTS2.md (28.09, вторая волна)."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.core.timeutils import today_str
from app.services.auth_service import hash_password
from app.storage.repository import Repository

BASE = "/api/v1"


def _make_user(session_factory, login: str, role: str, engineer_id: str | None = None):
    session = session_factory()
    Repository(session).create_user(
        login=login, name=login, role=role,
        password_hash=hash_password("demo2026"), region_ids=["east"], engineer_id=engineer_id,
    )
    session.close()


def _headers(client: TestClient, login: str) -> dict:
    token = client.post(
        f"{BASE}/auth/login", json={"login": login, "password": "demo2026"}
    ).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _from_min(value: str) -> int:
    hours, minutes = value.split(":")
    return int(hours) * 60 + int(minutes)


def _applied(client: TestClient, scenario_id: str) -> dict:
    plan = client.post(
        f"{BASE}/planning/run",
        json={"scenario_id": scenario_id, "time_limit_seconds": 2, "include_baseline": False},
    ).json()
    client.post(f"{BASE}/planning/{plan['plan_id']}/apply")
    return plan


def _active_plan_id(client: TestClient, scenario_id: str) -> str:
    items = client.get(f"{BASE}/planning?scenario_id={scenario_id}").json()["items"]
    return next(item["plan_id"] for item in items if item["status"] == "applied")


def _urgent(client: TestClient, plan_id: str, request_id: str) -> dict:
    return client.post(
        f"{BASE}/events/apply",
        json={
            "type": "urgent_order_added", "plan_id": plan_id, "event_time": "12:30",
            "source": "dispatcher",
            "request": {
                "id": request_id, "latitude": 55.70, "longitude": 37.76,
                "duration_minutes": 80, "window_start": "12:30", "window_end": "22:00",
                "priority": "urgent", "required_skill": "emergency",
            },
        },
    ).json()


# --- P0-21: принятая версия сохраняет факты ---------------------------------
def test_applied_version_keeps_facts(isolated_client) -> None:
    client, _ = isolated_client
    scenario_id = client.post(f"{BASE}/data/load-demo?region_id=east").json()["scenario_id"]
    _applied(client, scenario_id)
    client.post(
        f"{BASE}/data/scenarios/{scenario_id}/clock", json={"time": "12:30", "autoplay": True}
    )
    active = _active_plan_id(client, scenario_id)
    before = client.get(f"{BASE}/planning/{active}").json()
    done_before = sum(
        1 for route in before["routes"] for point in route["route"] if point["status"] == "done"
    )
    assert done_before > 0

    event = _urgent(client, active, "U-FACT-1")
    new_plan = client.post(f"{BASE}/planning/{event['plan']['plan_id']}/apply").json()
    after = client.get(f"{BASE}/planning/{new_plan['plan_id']}").json()
    done_after = sum(
        1 for route in after["routes"] for point in route["route"] if point["status"] == "done"
    )
    assert done_after == done_before

    day = client.get(f"{BASE}/days/{today_str()}?region_id=east").json()
    east = next(r for r in day["regions"] if r["region_id"] == "east")
    assert east["active_plan_id"] == new_plan["plan_id"]


# --- P0-14: срочная заявка не «прибывает» раньше события --------------------
def test_urgent_not_before_event_time(isolated_client) -> None:
    client, _ = isolated_client
    scenario_id = client.post(f"{BASE}/data/load-demo?region_id=east").json()["scenario_id"]
    _applied(client, scenario_id)
    client.post(f"{BASE}/data/scenarios/{scenario_id}/clock", json={"time": "12:30"})
    active = _active_plan_id(client, scenario_id)
    event = _urgent(client, active, "U-TIME-1")
    urgent = event["scenario"]["urgent"]
    assert _from_min(urgent["arrival"]) >= _from_min("12:30")
    assert urgent["reaction_min"] is None or urgent["reaction_min"] >= 0


# --- P0-13: «Прервать» убирает заявку из активных ---------------------------
def test_fail_clears_active_request_and_restore_on_reject(isolated_client) -> None:
    client, factory = isolated_client
    scenario_id = client.post(f"{BASE}/data/load-demo?region_id=east").json()["scenario_id"]
    plan = _applied(client, scenario_id)
    assignment = next(a for a in plan["assignments"])
    engineer_id = assignment["engineer_id"]
    request_id = assignment["request_id"]
    _make_user(factory, f"eng-{engineer_id.lower()}", "engineer", engineer_id=engineer_id)
    _make_user(factory, "dispatcher", "dispatcher")

    settings = get_settings()
    original = settings.auth_enabled
    settings.auth_enabled = True
    try:
        headers = _headers(client, f"eng-{engineer_id.lower()}")
        dispatcher_headers = _headers(client, "dispatcher")
        fail = client.post(
            f"{BASE}/engineers/me/actions",
            json={"action": "fail", "request_id": request_id,
                  "payload": {"reason": "client_refused"}},
            headers=headers,
        )
        assert fail.status_code == 200, fail.text
        day = client.get(f"{BASE}/engineers/me/day", headers=headers).json()
        assert day["active_request_id"] is None
        statuses = {v["request_id"]: v["status"] for v in day["visits"]}
        assert statuses.get(request_id) == "cancel_pending"

        # Отклонение предложения возвращает точку в прежний статус.
        days = client.get(f"{BASE}/days/{today_str()}?region_id=east", headers=dispatcher_headers).json()
        east = next(r for r in days["regions"] if r["region_id"] == "east")
        proposed_id = east["pending_proposals"][0]["plan_id"]
        client.post(f"{BASE}/planning/{proposed_id}/reject", headers=dispatcher_headers)
        day2 = client.get(f"{BASE}/engineers/me/day", headers=headers).json()
        statuses2 = {v["request_id"]: v["status"] for v in day2["visits"]}
        assert statuses2.get(request_id) == "planned"
    finally:
        settings.auth_enabled = original


# --- P1-16 / P1-17: поиск, отмена и запись в день региона -------------------
def test_operator_search_cancel_and_booking_same_day(isolated_client) -> None:
    client, _ = isolated_client
    summary = client.post(f"{BASE}/data/load-demo?region_id=east").json()
    scenario_id = summary["scenario_id"]
    day = today_str()

    # Запись на уже существующий день региона → тот же сценарий, номер BK-дата.
    created = client.post(
        f"{BASE}/booking/requests",
        json={"region_id": "east", "date": day, "window": "10:00-12:00",
              "type_bk": "Подключение", "address": "Москва, ул. Запись, 1"},
    ).json()
    assert created["scenario_id"] == scenario_id
    assert created["request_id"].startswith(f"BK-{day.replace('-', '')}-")
    assert created["status"] == "planned"

    # Поиск по дню находит заявку (не только записи оператора).
    found = client.get(f"{BASE}/booking/requests?q={created['request_id']}").json()
    assert any(item["request_id"] == created["request_id"] for item in found)

    # Начатый день: отмена — предложением диспетчеру.
    items = client.get(f"{BASE}/planning?scenario_id={scenario_id}").json()["items"]
    draft = next(item for item in items if item["status"] == "draft")
    client.post(f"{BASE}/planning/{draft['plan_id']}/apply")
    cancel = client.post(
        f"{BASE}/booking/requests/{created['request_id']}/cancel",
        json={"reason": "client_refused"},
    ).json()
    assert cancel["status"] == "cancel_pending"
    assert cancel["plan_id"]
    days = client.get(f"{BASE}/days/{day}?region_id=east").json()
    east = next(r for r in days["regions"] if r["region_id"] == "east")
    assert any(p["plan_id"] == cancel["plan_id"] for p in east["pending_proposals"])


# --- P2-20: номер версии не занимает отклонённое предложение ----------------
def test_version_numbering_has_no_gaps(isolated_client) -> None:
    client, _ = isolated_client
    scenario_id = client.post(f"{BASE}/data/load-demo?region_id=east").json()["scenario_id"]
    plan = _applied(client, scenario_id)
    first = client.get(f"{BASE}/planning/{plan['plan_id']}").json()
    assert first["version"] == 1

    rejected = _urgent(client, plan["plan_id"], "U-GAP-1")
    client.post(f"{BASE}/planning/{rejected['plan']['plan_id']}/reject")
    second = _urgent(client, plan["plan_id"], "U-GAP-2")
    applied = client.post(f"{BASE}/planning/{second['plan']['plan_id']}/apply").json()
    assert applied["plan_id"] == second["plan"]["plan_id"]
    versioned = client.get(f"{BASE}/planning/{applied['plan_id']}").json()
    assert versioned["version"] == 2
    day = client.get(f"{BASE}/days/{today_str()}?region_id=east").json()
    east = next(r for r in day["regions"] if r["region_id"] == "east")
    assert east["version"] == 2


# --- P2-23: «Реальный диспетчер» считает километры и визиты -----------------
def test_dispatcher_km_and_visits(isolated_client) -> None:
    client, _ = isolated_client
    scenario_id = client.post(f"{BASE}/data/load-demo?region_id=east").json()["scenario_id"]
    body = client.post(
        f"{BASE}/planning/compare",
        json={"scenario_id": scenario_id, "strategies": ["dispatcher"], "time_limit_seconds": 2},
    ).json()
    column = body["columns"]["dispatcher"]
    assert column["visits_total"] > 0
    assert sum(item["km"] for item in column["km_by_engineer"]) > 0
    assert column["km_total"] > 0


# --- P2-22: время баннера — московское --------------------------------------
def test_banner_time_uses_local_timezone() -> None:
    from app.api.routes.engineers import _local_hhmm

    assert _local_hhmm(datetime(2026, 9, 28, 9, 21, tzinfo=timezone.utc)) == "12:21"


# --- P1-15: геокодер (провайдер none / кэш) ---------------------------------
def test_geocoder_none_and_cache() -> None:
    from app.core.config import get_settings
    from app.services.geocoder import Geocoder

    class _Repo:
        def __init__(self):
            self.store: dict = {}

        def get_geocode(self, address):
            return self.store.get(address)

        def upsert_geocode(self, address, latitude, longitude, provider):
            self.store[address] = type("R", (), {"latitude": latitude, "longitude": longitude})()

    settings = get_settings().model_copy(update={"geocoder_provider": "none"})
    geocoder = Geocoder(_Repo(), settings)
    assert geocoder.provider == "none"
    assert geocoder.geocode("Москва") is None


def test_geocoder_provider_and_cache() -> None:
    from app.core.config import get_settings
    from app.services.geocoder import Geocoder

    class _Repo:
        def __init__(self):
            self.store: dict = {}

        def get_geocode(self, address):
            return self.store.get(address)

        def upsert_geocode(self, address, latitude, longitude, provider):
            self.store[address] = type("R", (), {"latitude": latitude, "longitude": longitude})()

    class _Stub(Geocoder):
        def _yandex(self, address):
            return 55.7, 37.7

    settings = get_settings().model_copy(
        update={"geocoder_provider": "yandex", "yandex_geocoder_api_key": "test"}
    )
    repo = _Repo()
    geocoder = _Stub(repo, settings)
    assert geocoder.provider == "yandex"
    assert geocoder.geocode("Москва, Тверская 1") == (55.7, 37.7)
    assert "Москва, Тверская 1" in repo.store
    assert geocoder.geocode("Москва, Тверская 1") == (55.7, 37.7)


def test_geocoder_yandex_falls_back_to_nominatim() -> None:
    from app.core.config import get_settings
    from app.services.geocoder import Geocoder

    class _Repo:
        def __init__(self):
            self.store: dict = {}

        def get_geocode(self, address):
            return self.store.get(address)

        def upsert_geocode(self, address, latitude, longitude, provider):
            self.store[address] = type("R", (), {"latitude": latitude, "longitude": longitude})()

    class _Stub(Geocoder):
        def _yandex(self, address):
            raise RuntimeError("Invalid api key")

        def _nominatim(self, address):
            return 55.70, 37.74

    settings = get_settings().model_copy(
        update={"geocoder_provider": "yandex", "yandex_geocoder_api_key": "bad"}
    )
    geocoder = _Stub(_Repo(), settings)
    assert geocoder.geocode("Москва, ул. Юных Ленинцев, 50") == (55.70, 37.74)


def test_geocoder_rejects_point_outside_bbox() -> None:
    """Точка вне рамки региона считается ненайденной (Яндекс иногда угадывает не туда)."""
    from app.core.config import get_settings
    from app.services.geocoder import Geocoder

    class _Repo:
        def get_geocode(self, address):
            return None

        def upsert_geocode(self, address, latitude, longitude, provider):
            raise AssertionError("не должны кэшировать точку вне рамки")

    class _Stub(Geocoder):
        def _yandex(self, address):
            return 56.83, 60.60  # Екатеринбург, вне московской рамки

        def _nominatim(self, address):
            return None

    settings = get_settings().model_copy(
        update={"geocoder_provider": "yandex", "yandex_geocoder_api_key": "test",
                "geocoder_bbox": "35.1,54.2~40.3,57.0"}
    )
    assert _Stub(_Repo(), settings).geocode("qwerty qwerty 12345") is None


# --- P1-19: отмена не перекраивает полдня -----------------------------------
def test_cancel_replans_minimally(isolated_client) -> None:
    client, _ = isolated_client
    scenario_id = client.post(f"{BASE}/data/load-demo?region_id=east").json()["scenario_id"]
    plan = _applied(client, scenario_id)
    client.post(f"{BASE}/data/scenarios/{scenario_id}/clock", json={"time": "12:30"})
    active = _active_plan_id(client, scenario_id)
    assignment = next(a for a in plan["assignments"])
    result = client.post(
        f"{BASE}/events/apply",
        json={
            "type": "order_cancelled", "plan_id": active, "event_time": "12:30",
            "source": "dispatcher", "order_id": assignment["request_id"], "apply": False,
            "params": {"reason": "client_refused", "stage": "call"},
        },
    ).json()
    reassigned = [c for c in result["changes"] if c.get("kind") == "reassigned"]
    assert reassigned == []


# --- P1-18: ленивое создание демо-дня ---------------------------------------
def test_lazy_demo_day(isolated_client) -> None:
    client, _ = isolated_client
    day = client.get(f"{BASE}/days/{today_str()}?region_id=south_center").json()
    region = next((r for r in day["regions"] if r["region_id"] == "south_center"), None)
    assert region is not None
    assert region["plan_state"] == "applied"

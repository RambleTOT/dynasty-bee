"""Тесты правок из docs/BACKEND_REQUESTS.md (28.09)."""
from __future__ import annotations

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


def _applied_plan(client: TestClient, scenario_id: str, time_limit: float = 2) -> dict:
    plan = client.post(
        f"{BASE}/planning/run",
        json={"scenario_id": scenario_id, "time_limit_seconds": time_limit, "include_baseline": False},
    ).json()
    client.post(f"{BASE}/planning/{plan['plan_id']}/apply")
    return plan


def _urgent(client: TestClient, plan_id: str, request_id: str) -> dict:
    return client.post(
        f"{BASE}/events/apply",
        json={
            "type": "urgent_order_added",
            "plan_id": plan_id,
            "event_time": "12:30",
            "source": "operator",
            "request": {
                "id": request_id, "latitude": 55.70, "longitude": 37.76,
                "duration_minutes": 80, "window_start": "12:30", "window_end": "22:00",
                "priority": "urgent", "required_skill": "emergency",
                "required_transport": "car", "type_bk": "Глобальная проблема", "type_hd": "Авария",
            },
        },
    ).json()


# --- P0-3: новая версия плана видна дню ------------------------------------
def test_new_version_visible_to_day_and_proposals(isolated_client) -> None:
    client, _ = isolated_client
    scenario_id = client.post(f"{BASE}/data/load-demo?region_id=east").json()["scenario_id"]
    plan = _applied_plan(client, scenario_id)

    day = client.get(f"{BASE}/days/{today_str()}?region_id=east").json()
    east = next(r for r in day["regions"] if r["region_id"] == "east")
    assert east["active_plan_id"] == plan["plan_id"]
    assert east["version"] == 1
    assert east["plan_state"] == "applied"

    event = _urgent(client, plan["plan_id"], "U-DAY-1")
    assert event["status"] == "proposed"
    proposal_id = event["plan"]["plan_id"]

    day2 = client.get(f"{BASE}/days/{today_str()}?region_id=east").json()
    east2 = next(r for r in day2["regions"] if r["region_id"] == "east")
    assert east2["active_plan_id"] == plan["plan_id"]
    proposals = east2["pending_proposals"]
    assert any(p["plan_id"] == proposal_id for p in proposals)
    assert all("event_type" in p and "created_at" in p for p in proposals)

    applied = client.post(f"{BASE}/planning/{proposal_id}/apply")
    assert applied.status_code == 200, applied.text
    day3 = client.get(f"{BASE}/days/{today_str()}?region_id=east").json()
    east3 = next(r for r in day3["regions"] if r["region_id"] == "east")
    assert east3["active_plan_id"] == proposal_id
    assert east3["version"] == 2


def test_engineer_sees_applied_changes(isolated_client) -> None:
    client, factory = isolated_client
    scenario_id = client.post(f"{BASE}/data/load-demo?region_id=east").json()["scenario_id"]
    plan = _applied_plan(client, scenario_id)
    event = _urgent(client, plan["plan_id"], "U-VIS-1")
    client.post(f"{BASE}/planning/{event['plan']['plan_id']}/apply")

    # Инженер, которому назначили новую заявку, видит её в /engineers/me/day.
    assignment = next(
        a for a in event["plan"]["assignments"] if a["request_id"] == "U-VIS-1"
    )
    engineer_id = assignment["engineer_id"]
    index = int(engineer_id.lstrip("E"))
    login = f"eng-east-{index:02d}"
    _make_user(factory, login, "engineer", engineer_id=engineer_id)

    settings = get_settings()
    original = settings.auth_enabled
    settings.auth_enabled = True
    try:
        headers = _headers(client, login)
        me = client.get(f"{BASE}/engineers/me/day", headers=headers)
        assert me.status_code == 200, me.text
        assert me.json()["plan_published"] is True
        assert "U-VIS-1" in {visit["request_id"] for visit in me.json()["visits"]}
    finally:
        settings.auth_enabled = original


def test_engineer_auth_me_and_logout(isolated_client) -> None:
    """P0-2: инженеру открыты /auth/me и /auth/logout."""
    client, factory = isolated_client
    _make_user(factory, "eng-east-02", "engineer", engineer_id="E02")
    settings = get_settings()
    original = settings.auth_enabled
    settings.auth_enabled = True
    try:
        headers = _headers(client, "eng-east-02")
        me = client.get(f"{BASE}/auth/me", headers=headers)
        assert me.status_code == 200, me.text
        assert me.json()["engineer_id"] == "E02"
        assert client.post(f"{BASE}/auth/logout", headers=headers).status_code in {200, 204}
    finally:
        settings.auth_enabled = original


# --- P1-5: добор ресурса без сохранения -------------------------------------
def test_extend_resource_check_does_not_persist(isolated_client) -> None:
    client, _ = isolated_client
    scenario_id = client.post(f"{BASE}/data/load-demo?region_id=east").json()["scenario_id"]
    plan = client.post(
        f"{BASE}/planning/run",
        json={"scenario_id": scenario_id, "time_limit_seconds": 2, "include_baseline": False},
    ).json()
    unassigned = [u["request_id"] for u in plan["unassigned"]]
    engineer_id = plan["routes"][0]["engineer_id"]
    events_before = len(client.get(f"{BASE}/events").json())
    response = client.post(
        f"{BASE}/planning/{plan['plan_id']}/extend-resource/check",
        json={"order_ids": unassigned, "option": "extend_shift",
              "params": {"engineer_id": engineer_id, "extend_min": 60}},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == {"closed", "still_unassigned", "cost"}
    assert len(client.get(f"{BASE}/events").json()) == events_before


# --- P1-6: добавить инженера в начатый день ---------------------------------
def test_engineer_added_event(isolated_client) -> None:
    client, _ = isolated_client
    scenario_id = client.post(f"{BASE}/data/load-demo?region_id=east").json()["scenario_id"]
    plan = _applied_plan(client, scenario_id)
    response = client.post(
        f"{BASE}/events/apply",
        json={
            "type": "engineer_added", "plan_id": plan["plan_id"], "source": "dispatcher",
            "apply": False,
            "engineer": {"name": "Бригада Новиков", "skills": ["installation", "local"],
                         "transport": "car", "shift_start": "12:00", "shift_end": "22:00",
                         "start": {"kind": "office"}},
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "proposed"
    new_id = body["scenario"]["engineer_added"]["engineer_id"]
    engineer_ids = {r["engineer_id"] for r in body["plan"]["routes"]}
    assert new_id in engineer_ids
    assert any("Бригада Новиков" in (r.get("engineer_name") or "") for r in body["plan"]["routes"])


# --- P1-8: стратегия "plan" -------------------------------------------------
def test_compare_plan_strategy(isolated_client) -> None:
    client, _ = isolated_client
    scenario_id = client.post(f"{BASE}/data/load-demo?region_id=east").json()["scenario_id"]
    plan = client.post(
        f"{BASE}/planning/run",
        json={"scenario_id": scenario_id, "time_limit_seconds": 2, "include_baseline": False},
    ).json()
    response = client.post(
        f"{BASE}/planning/compare",
        json={"scenario_id": scenario_id, "plan_id": plan["plan_id"],
              "strategies": ["plan", "fifo", "dispatcher"], "time_limit_seconds": 2},
    )
    assert response.status_code == 200, response.text
    column = response.json()["columns"]["plan"]
    assert column["available"] is True
    assert column["visits_total"] > 0
    assert "plan" in response.json()["km_by_engineer"].get(plan["routes"][0]["engineer_id"], {})


# --- P1-7: календарь по действующему плану ----------------------------------
def test_calendar_by_status_uses_active_plan(isolated_client) -> None:
    client, _ = isolated_client
    scenario_id = client.post(f"{BASE}/data/load-demo?region_id=east").json()["scenario_id"]
    _applied_plan(client, scenario_id)
    day = today_str()
    calendar = client.get(f"{BASE}/calendar?from={day}&to={day}&region_id=east").json()
    by_status = calendar["days"][0]["by_status"]
    assert by_status.get("planned", 0) > 0


# --- P1-4 / P2-12: импорт CSV ------------------------------------------------
CSV_REQUESTS = (
    "Заявка;Тип заявки BK;Тип заявки HD;Начало;Окончание;Район;Адрес;Гигабитное подключение\r\n"
    "1;Подключение;Конвергенция абонента;10:00;12:00;Даниловский;г. Москва, ул. A, д. 1;Нет\r\n"
    "\r\nАдрес Офиса;г. Москва, ул. Юных Ленинцев, д. 83с4;;;;;;\r\n"
)
CSV_CONTROL = (
    "Заявка;Тип заявки BK;Начало;Окончание;Адрес;Бригада\r\n"
    "1;Подключение;10:00;12:00;г. Москва, ул. A, д. 1;Бригада 1\r\n"
)
CSV_OFFICE = "Адрес Офиса;г. Москва, ул. Юных Ленинцев, д. 83с4;;;;;;\r\n"


def test_import_dispatcher_id_and_office_trim(isolated_client) -> None:
    client, _ = isolated_client
    response = client.post(
        f"{BASE}/data/import-beeline",
        files={
            "requests_file": ("r.csv", CSV_REQUESTS.encode("utf-8"), "text/csv"),
            "control_file": ("c.csv", CSV_CONTROL.encode("utf-8"), "text/csv"),
        },
        data={"region_id": "east", "date": "2026-12-02"},
    )
    assert response.status_code == 201, response.text
    summary = response.json()
    report = summary["import_report"]
    assert report["office"]["address"] == "г. Москва, ул. Юных Ленинцев, д. 83с4"
    scenario = client.get(f"{BASE}/data/scenarios/{summary['scenario_id']}").json()
    assert scenario["requests"][0]["dispatcher_engineer_id"] == "E01"


# --- P2-11: район в окнах записи --------------------------------------------
def test_booking_slots_district(isolated_client) -> None:
    client, _ = isolated_client
    client.post(
        f"{BASE}/booking/requests",
        json={"region_id": "east", "date": "2026-12-03", "window": "10:00-12:00",
              "type_bk": "Подключение", "address": "Москва, ул. Тестовая, 1",
              "district": "Даниловский"},
    )
    slots = client.get(
        f"{BASE}/booking/slots?region_id=east&date=2026-12-03&type_bk=Подключение"
        f"&address=Москва, ул. Тестовая, 1"
    ).json()
    assert slots["district"] == "Даниловский"

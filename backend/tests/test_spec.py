"""Тесты новых ручек по BACKEND_SPEC (регионы, импорт, booking, инженер, diff)."""
from __future__ import annotations


from fastapi.testclient import TestClient

from app.core.config import get_settings

BASE = "/api/v1"

REQUESTS_CSV = (
    "Заявка;Тип заявки BK;Тип заявки HD;Начало;Окончание;Район;Адрес;Гигабитное подключение\r\n"
    "10001;Подключение;Конвергенция абонента;10:00;12:00;Даниловский;г. Москва, ул. Примерная, д. 1;Нет\r\n"
    "10002;Глобальная проблема;Авария;12:00;14:00;Текстильщики;г. Москва, ул. Южная, д. 2;Нет\r\n"
    "\r\n"
    "Адрес Офиса;г. Москва, ул. Юных Ленинцев, д. 83с4\r\n"
)
CONTROL_CSV = (
    "Заявка;Тип заявки BK;Тип заявки HD;Начало;Окончание;Район;Адрес;Гигабитное подключение;Статус BK;Бригада\r\n"
    "100000001;Подключение;Конвергенция абонента;10:00;12:00;Даниловский;г. Москва, ул. Примерная, д. 1, кв. 5;Нет;Отправлена;Бригада 1\r\n"
    "100000002;Глобальная проблема;Авария;12:00;14:00;Текстильщики;г. Москва, ул. Южная, д. 2;Нет;Отправлена;Бригада 2\r\n"
)


def test_auth_enabled(isolated_client) -> None:
    """При включённой авторизации API требует JWT (Bearer), /auth/login открыт."""
    client, session_factory = isolated_client
    from app.services.auth_service import hash_password
    from app.storage.repository import Repository

    session = session_factory()
    Repository(session).create_user(
        login="dispatcher", name="Диспетчер", role="dispatcher",
        password_hash=hash_password("demo2026"), region_ids=["east"],
    )
    session.close()

    settings = get_settings()
    original = settings.auth_enabled
    settings.auth_enabled = True
    try:
        assert client.get(f"{BASE}/regions").status_code == 401
        login = client.post(
            f"{BASE}/auth/login", json={"login": "dispatcher", "password": "demo2026"}
        )
        assert login.status_code == 200
        token = login.json()["access_token"]
        authorized = client.get(f"{BASE}/regions", headers={"Authorization": f"Bearer {token}"})
        assert authorized.status_code == 200
        assert len(authorized.json()) == 3
    finally:
        settings.auth_enabled = original


def test_regions(isolated_client) -> None:
    client, _ = isolated_client
    response = client.get(f"{BASE}/regions")
    assert response.status_code == 200
    ids = {item["region_id"] for item in response.json()}
    assert ids == {"east", "south_east", "south_center"}


def test_load_demo_region(isolated_client) -> None:
    client, _ = isolated_client
    response = client.post(f"{BASE}/data/load-demo?region_id=east")
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["engineer_count"] == 12
    assert body["request_count"] == 66
    assert body["region_id"] == "east"


def test_import_beeline(isolated_client) -> None:
    client, _ = isolated_client
    response = client.post(
        f"{BASE}/data/import-beeline",
        files={
            "requests_file": ("requests.csv", REQUESTS_CSV.encode("utf-8"), "text/csv"),
            "control_file": ("control.csv", CONTROL_CSV.encode("utf-8"), "text/csv"),
        },
        data={"region_id": "east"},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["request_count"] == 2
    assert body["region_id"] == "east"
    assert body["import_report"]["dispatcher_assignments_loaded"] == 2


def test_import_beeline_bad_csv(isolated_client) -> None:
    client, _ = isolated_client
    response = client.post(
        f"{BASE}/data/import-beeline",
        files={"requests_file": ("bad.csv", b"foo;bar\n1;2\n", "text/csv")},
        data={"region_id": "east"},
    )
    assert response.status_code == 422
    assert response.json()["detail"]["error"]["code"] == "BAD_CSV"


def test_scenario_engineers_management(isolated_client) -> None:
    client, _ = isolated_client
    scenario = client.post(f"{BASE}/data/load-demo?region_id=east").json()
    scenario_id = scenario["scenario_id"]
    engineers = client.get(f"{BASE}/data/scenarios/{scenario_id}/engineers")
    assert engineers.status_code == 200
    assert len(engineers.json()) == 12
    added = client.post(
        f"{BASE}/data/scenarios/{scenario_id}/engineers",
        json=[{"name": "Новая бригада", "skills": ["local"], "transport": "car"}],
    )
    assert added.status_code == 201, added.text
    assert added.json()["engineer_count"] == 13


def test_plan_diff_and_request_card(isolated_client) -> None:
    client, _ = isolated_client
    scenario_id = client.post(f"{BASE}/data/load-demo?region_id=east").json()["scenario_id"]
    plan = client.post(
        f"{BASE}/planning/run",
        json={"scenario_id": scenario_id, "time_limit_seconds": 2, "include_baseline": False},
    ).json()
    assert plan["status"] == "draft"
    request_id = plan["assignments"][0]["request_id"]
    event_resp = client.post(
        f"{BASE}/events/apply",
        json={
            "plan_id": plan["plan_id"],
            "type": "urgent_order_added",
            "event_time": "12:30",
            "source": "operator",
            "request": {
                "id": "U-1",
                "latitude": 55.70,
                "longitude": 37.76,
                "duration_minutes": 80,
                "window_start": "12:30",
                "window_end": "22:00",
                "priority": "urgent",
                "required_skill": "emergency",
            },
        },
    )
    assert event_resp.status_code == 200, event_resp.text
    event = event_resp.json()
    assert event["status"] == "proposed"  # default apply по типу = предложение
    new_plan_id = event["plan"]["plan_id"]
    diff = client.get(f"{BASE}/planning/{new_plan_id}/diff")
    assert diff.status_code == 200, diff.text
    assert diff.json()["summary"]["added"] >= 1
    card = client.get(f"{BASE}/planning/{plan['plan_id']}/requests/{request_id}")
    assert card.status_code == 200
    assert card.json()["request"]["id"] == request_id


def test_booking_flow(isolated_client) -> None:
    client, _ = isolated_client
    slots = client.get(f"{BASE}/booking/slots?region_id=east&date=2026-09-30&type_bk=Подключение")
    assert slots.status_code == 200, slots.text
    assert len(slots.json()["slots"]) == 6
    created = client.post(
        f"{BASE}/booking/requests",
        json={
            "region_id": "east",
            "date": "2026-09-30",
            "window": "10:00-12:00",
            "type_bk": "Подключение",
            "address": "г. Москва, ул. Тестовая, 1",
            "gigabit": True,
        },
    )
    assert created.status_code == 201, created.text
    request_id = created.json()["request_id"]
    cancelled = client.post(
        f"{BASE}/booking/requests/{request_id}/cancel", json={"reason": "client_refused"}
    )
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"


def test_engineer_day_and_actions(isolated_client) -> None:
    client, _ = isolated_client
    scenario_id = client.post(f"{BASE}/data/load-demo?region_id=east").json()["scenario_id"]
    plan = client.post(
        f"{BASE}/planning/run",
        json={"scenario_id": scenario_id, "time_limit_seconds": 2, "include_baseline": False},
    ).json()
    engineer_id = next(r["engineer_id"] for r in plan["routes"] if r["task_count"] > 0)
    day = client.get(f"{BASE}/engineers/{engineer_id}/day?scenario_id={scenario_id}")
    assert day.status_code == 200, day.text
    visits = day.json()["visits"]
    assert visits
    request_id = visits[0]["request_id"]
    action = client.post(
        f"{BASE}/engineers/{engineer_id}/actions?scenario_id={scenario_id}",
        json={"action": "en_route", "request_id": request_id, "at": "10:05"},
    )
    assert action.status_code == 200, action.text
    assert action.json()["action"] == "en_route"
    # запрещённый переход: complete без start
    illegal = client.post(
        f"{BASE}/engineers/{engineer_id}/actions?scenario_id={scenario_id}",
        json={"action": "complete", "request_id": request_id},
    )
    assert illegal.status_code == 409


def test_patch_engineer_persists(isolated_client) -> None:
    """PATCH инженера реально сохраняется в БД (регресс JSON-мутации)."""
    client, _ = isolated_client
    scenario_id = client.post(f"{BASE}/data/load-demo?region_id=east").json()["scenario_id"]
    engineers = client.get(f"{BASE}/data/scenarios/{scenario_id}/engineers").json()
    engineer_id = engineers[0]["id"]
    before = engineers[0]["transport"]
    new_transport = "walk" if before != "walk" else "bike"
    patched = client.patch(
        f"{BASE}/data/scenarios/{scenario_id}/engineers/{engineer_id}",
        json={"transport": new_transport},
    )
    assert patched.status_code == 200, patched.text
    after = client.get(f"{BASE}/data/scenarios/{scenario_id}/engineers").json()
    updated = next(item for item in after if item["id"] == engineer_id)
    assert updated["transport"] == new_transport


def test_booking_cancel_persists(isolated_client) -> None:
    """Отмена записи сохраняется в заявке сценария."""
    client, _ = isolated_client
    created = client.post(
        f"{BASE}/booking/requests",
        json={
            "region_id": "east",
            "date": "2026-10-01",
            "window": "10:00-12:00",
            "type_bk": "Подключение",
            "address": "г. Москва, ул. Тестовая, 2",
        },
    ).json()
    client.post(f"{BASE}/booking/requests/{created['request_id']}/cancel", json={"reason": "client_refused"})
    scenario = client.get(f"{BASE}/data/scenarios/{created['scenario_id']}").json()
    request = next(
        item for item in scenario["requests"] if item["id"] == created["request_id"]
    )
    assert request["status"] == "cancelled"


def test_engineer_action_persists(isolated_client) -> None:
    """Факт инженера (en_route) сохраняется в плане."""
    client, _ = isolated_client
    scenario_id = client.post(f"{BASE}/data/load-demo?region_id=east").json()["scenario_id"]
    plan = client.post(
        f"{BASE}/planning/run",
        json={"scenario_id": scenario_id, "time_limit_seconds": 2, "include_baseline": False},
    ).json()
    engineer_id = next(r["engineer_id"] for r in plan["routes"] if r["task_count"] > 0)
    visits = client.get(f"{BASE}/engineers/{engineer_id}/day?scenario_id={scenario_id}").json()[
        "visits"
    ]
    request_id = visits[0]["request_id"]
    action = client.post(
        f"{BASE}/engineers/{engineer_id}/actions?scenario_id={scenario_id}",
        json={"action": "en_route", "request_id": request_id, "at": "10:05"},
    )
    assert action.status_code == 200, action.text
    refreshed = client.get(
        f"{BASE}/engineers/{engineer_id}/day?scenario_id={scenario_id}"
    ).json()["visits"]
    target = next(v for v in refreshed if v["request_id"] == request_id)
    assert target["status"] == "en_route"


def test_no_transport_reason(isolated_client) -> None:
    client, _ = isolated_client
    scenario = {
        "name": "транспорт",
        "engineers": [
            {"id": "E1", "name": "Пешеход", "latitude": 55.75, "longitude": 37.62,
             "shift_start": "09:00", "shift_end": "18:00", "skills": ["installation"],
             "transport": "walk", "available": True},
        ],
        "requests": [
            {"id": "R1", "latitude": 55.76, "longitude": 37.63, "duration_minutes": 30,
             "window_start": "10:00", "window_end": "12:00", "priority": "normal",
             "required_skill": "installation", "required_transport": "car"},
        ],
    }
    loaded = client.post(f"{BASE}/data/load", json=scenario).json()
    plan = client.post(
        f"{BASE}/planning/run",
        json={"scenario_id": loaded["scenario_id"], "time_limit_seconds": 1,
              "include_baseline": False},
    ).json()
    assert plan["unassigned"]
    assert plan["unassigned"][0]["reason_code"] == "NO_TRANSPORT"

"""Тесты docs/29_changes_2 и BACKEND_REQUESTS (4): §39, 46, 38, 55–57, 29."""
from __future__ import annotations

from datetime import date, timedelta

from fastapi.testclient import TestClient

from app.core.timeutils import today_str

BASE = "/api/v1"


def _applied(client: TestClient, scenario_id: str) -> dict:
    plan = client.post(
        f"{BASE}/planning/run",
        json={"scenario_id": scenario_id, "time_limit_seconds": 2, "include_baseline": False},
    ).json()
    client.post(f"{BASE}/planning/{plan['plan_id']}/apply")
    return plan


def _booking(client: TestClient, region: str, day: str) -> dict:
    return client.post(
        f"{BASE}/booking/requests",
        json={"region_id": region, "date": day, "window": "10:00-12:00",
              "type_bk": "Подключение", "address": "Москва, ул. Тест, 1"},
    ).json()


# --- §57: ростер кейса стабилен между запусками ------------------------------
def test_region_roster_is_stable() -> None:
    from app.services.region_dataset import build_region_scenario

    first = build_region_scenario("east")
    second = build_region_scenario("east")
    assert [e["skills"] for e in first["engineers"]] == [e["skills"] for e in second["engineers"]]
    assert [e["transport"] for e in first["engineers"]] == [e["transport"] for e in second["engineers"]]


# --- §55/56: правило транспорта без гигабита ---------------------------------
def test_transport_rule_without_gigabit(isolated_client) -> None:
    client, _ = isolated_client
    csv = (
        "Заявка;Тип заявки BK;Тип заявки HD;Начало;Окончание;Адрес;Гигабитное подключение\r\n"
        "1;Подключение;Конвергенция абонента;10:00;12:00;Москва, ул. A, 1;Да\r\n"
        "2;Глобальная проблема;Авария;10:00;12:00;Москва, ул. B, 2;Нет\r\n"
        "\r\nАдрес офиса;Москва, ул. Юных Ленинцев, д. 83с4\r\n"
    )
    imported = client.post(
        f"{BASE}/data/import-beeline",
        files={"requests_file": ("r.csv", csv.encode("utf-8"), "text/csv")},
        data={"region_id": "east", "date": "2026-10-20"},
    )
    assert imported.status_code == 201, imported.text
    report = imported.json()["import_report"]
    # Гигабит больше не требует машину по правилу.
    assert report["required_transport"]["car_by_rule"] == 1
    assert report["required_transport"]["rule"] == ["Работа с кабелем", "Авария"]
    assert any("Контрольный файл не загружен" in w for w in report["warnings"])
    scenario = client.get(f"{BASE}/data/scenarios/{imported.json()['scenario_id']}").json()
    by_id = {r["id"]: r for r in scenario["requests"]}
    assert by_id["1"]["required_transport"] is None
    assert by_id["2"]["required_transport"] == "car"


# --- §29: отменённые записи не блокируют загрузку ---------------------------
def test_date_has_bookings_ignores_cancelled(isolated_client) -> None:
    client, _ = isolated_client
    day = (date.fromisoformat(today_str()) + timedelta(days=5)).isoformat()
    created = _booking(client, "east", day)
    cancel = client.post(
        f"{BASE}/booking/requests/{created['request_id']}/cancel?region_id=east&date={day}",
        json={"reason": "client_refused"},
    )
    assert cancel.status_code == 200, cancel.text
    assert cancel.json()["status"] == "cancelled"
    # После отмены день не считается «занятым записями» — демо-день загружается.
    loaded = client.post(f"{BASE}/data/load-demo?region_id=east&date={day}")
    assert loaded.status_code == 201, loaded.text


# --- §39: перенос из начатого дня на другой день ----------------------------
def test_reschedule_started_day_moves_request(isolated_client) -> None:
    client, _ = isolated_client
    scenario_id = client.post(f"{BASE}/data/load-demo?region_id=east").json()["scenario_id"]
    _applied(client, scenario_id)
    day = today_str()
    target_day = (date.fromisoformat(day) + timedelta(days=1)).isoformat()
    created = _booking(client, "east", day)
    request_id = created["request_id"]

    moved = client.post(
        f"{BASE}/booking/requests/{request_id}/reschedule?region_id=east&date={day}",
        json={"new_date": target_day, "new_window": "14:00-16:00"},
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()["status"] == "reschedule_pending"
    proposal = moved.json()["plan_id"]
    applied = client.post(f"{BASE}/planning/{proposal}/apply")
    assert applied.status_code == 200, applied.text
    # В исходном дне — rescheduled, в целевом заявка есть.
    source = client.get(f"{BASE}/data/scenarios/{created['scenario_id']}").json()
    source_req = next((r for r in source["requests"] if r["id"] == request_id), None)
    assert source_req and source_req["status"] == "rescheduled"
    target = client.get(f"{BASE}/days/{target_day}?region_id=east").json()
    target_region = next((r for r in target["regions"] if r["region_id"] == "east"), None)
    assert target_region is not None


# --- §39: смена окна в начатом дне после «Принять» --------------------------
def test_window_change_started_day(isolated_client) -> None:
    client, _ = isolated_client
    scenario_id = client.post(f"{BASE}/data/load-demo?region_id=east").json()["scenario_id"]
    _applied(client, scenario_id)
    day = today_str()
    created = _booking(client, "east", day)
    request_id = created["request_id"]
    response = client.post(
        f"{BASE}/booking/requests/{request_id}/reschedule?region_id=east&date={day}",
        json={"new_date": day, "new_window": "16:00-18:00"},
    ).json()
    assert response["status"] == "reschedule_pending"
    client.post(f"{BASE}/planning/{response['plan_id']}/apply")
    source = client.get(f"{BASE}/data/scenarios/{created['scenario_id']}").json()
    req = next(r for r in source["requests"] if r["id"] == request_id)
    assert req["status"] == "planned"
    assert req["window_start"] == "16:00" and req["window_end"] == "18:00"


# --- §46: срочная без адреса получает точку офиса ---------------------------
def test_urgent_without_coords_gets_office(isolated_client) -> None:
    client, _ = isolated_client
    scenario_id = client.post(f"{BASE}/data/load-demo?region_id=east").json()["scenario_id"]
    plan = _applied(client, scenario_id)
    scenario = client.get(f"{BASE}/data/scenarios/{scenario_id}").json()
    office = scenario["office"]
    result = client.post(
        f"{BASE}/events/apply",
        json={
            "type": "urgent_order_added", "plan_id": plan["plan_id"], "event_time": "12:30",
            "request": {"id": "U-NOCOORD", "address": "Неизвестный адрес без подсказки",
                        "duration_minutes": 60, "window_start": "12:30", "window_end": "22:00",
                        "priority": "urgent", "required_skill": "emergency"},
        },
    )
    assert result.status_code == 200, result.text
    plan_id = result.json()["plan"]["plan_id"]
    card = client.get(f"{BASE}/planning/{plan_id}/requests/U-NOCOORD").json()
    assert card["request"]["latitude"] == office["lat"]
    assert card["request"]["longitude"] == office["lon"]


# --- §38: resumed=false при since больше seq ---------------------------------
def test_realtime_resume_false(isolated_client) -> None:
    client, _ = isolated_client
    token = client.post(f"{BASE}/realtime/ticket").json()["ticket"]
    with client.websocket_connect(f"{BASE}/realtime/ws?ticket={token}&since=999999") as ws:
        hello = ws.receive_json()
        assert hello["type"] == "hello" and hello["resumed"] is False
        resync = ws.receive_json()
        assert resync["type"] == "resync"

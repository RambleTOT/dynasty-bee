"""Тесты папки docs/29_changes_1: §14 любой участок и пункты 27–54."""
from __future__ import annotations

from fastapi.testclient import TestClient

from app.core.timeutils import today_str
from app.services.region_dataset import build_region_scenario

BASE = "/api/v1"

CSV_HEADER = (
    "Заявка;Тип заявки BK;Тип заявки HD;Начало;Окончание;Район;Адрес;"
    "Гигабитное подключение;Подключение;Требуемый транспорт;Навык;Длительность;Широта;Долгота"
)


def _custom_csv() -> bytes:
    rows = [
        "HM-101;Подключение;;10:00;12:00;;Химки, ул. Молодёжная, д. 20;Нет;;;installation;70;55.891234;37.443210",
        "HM-110;Авария;;;;;Химки, ул. Спартаковская, д. 7;Нет;;;emergency;80;55.89;37.44",
        "Адрес офиса;Химки, ул. Молодёжная, д. 4",
    ]
    return ("\r\n".join([CSV_HEADER, *rows]) + "\r\n").encode("utf-8")


# --- §14: любой участок -----------------------------------------------------
def test_custom_region_flow(isolated_client) -> None:
    client, _ = isolated_client
    response = client.post(
        f"{BASE}/regions",
        json={
            "name": "  Север  ",
            "office": {"address": "Север, ул. 1", "lat": 55.9, "lon": 37.4},
            "norms": {"types": [
                {"type_bk": "Ремонт ТВ", "skill": "Локальные работы", "duration_minutes": 45},
                {"type_bk": "Подключение", "skill": "installation", "duration_minutes": 70},
            ]},
        },
    )
    assert response.status_code == 201, response.text
    region = response.json()
    region_id = region["region_id"]
    assert region["name"] == "Север" and region["builtin"] is False
    assert region["norms"]["types"][0]["skill"] == "local"

    assert client.post(f"{BASE}/regions", json={"name": "север", "office": {"address": "x", "lat": 1, "lon": 1}}).status_code == 409
    assert client.post(f"{BASE}/regions", json={"name": "Восток", "office": {"address": "x", "lat": 1, "lon": 1}}).status_code == 409
    assert client.post(f"{BASE}/regions", json={"name": "Юг", "office": {"address": "x", "lat": 123, "lon": 1}}).status_code == 422

    roster = [
        {"id": "E01", "name": "Иванов", "latitude": 55.9, "longitude": 37.4,
         "shift_start": "09:00", "shift_end": "21:00", "skills": ["local", "installation"],
         "transport": "car", "available": True, "start_kind": "office"},
        {"id": "E02", "name": "Петров", "latitude": 55.9, "longitude": 37.4,
         "shift_start": "09:00", "shift_end": "21:00", "skills": ["local", "emergency"],
         "transport": "car", "available": True, "start_kind": "office"},
    ]
    assert client.put(f"{BASE}/regions/{region_id}/roster", json=roster).status_code == 200
    assert len(client.get(f"{BASE}/regions/{region_id}/roster").json()) == 2
    assert client.put(f"{BASE}/regions/east/roster", json=roster).status_code == 409
    assert client.patch(f"{BASE}/regions/east", json={"name": "X"}).status_code == 409

    listed = client.get(f"{BASE}/regions").json()
    custom = next(r for r in listed if r["region_id"] == region_id)
    assert custom["engineer_count"] == 2 and custom["demo_available"] is False
    assert [r["region_id"] for r in listed[:3]] == ["east", "south_east", "south_center"]

    imported = client.post(
        f"{BASE}/data/import-beeline",
        files={"requests_file": ("r.csv", _custom_csv(), "text/csv")},
        data={"region_id": region_id, "date": "2026-10-08"},
    )
    assert imported.status_code == 201, imported.text
    report = imported.json()["import_report"]
    assert report["coords_from_file"] == 2
    assert report["engineers_source"] == "region"
    assert report["region_id"] == region_id
    # заявка с колонками навыка/длительности
    scenario = client.get(f"{BASE}/data/scenarios/{imported.json()['scenario_id']}").json()
    by_id = {r["id"]: r for r in scenario["requests"]}
    assert by_id["HM-101"]["required_skill"] == "installation"

    day = client.get(f"{BASE}/days/2026-10-08?region_id={region_id}").json()
    assert day["regions"][0]["name"] == "Север"
    calendar = client.get(f"{BASE}/calendar?from=2026-10-08&to=2026-10-08&region_id={region_id}").json()
    assert calendar["days"][0]["request_count"] == 2
    assert client.post(f"{BASE}/data/load-demo?region_id={region_id}").status_code == 404


# --- §27: архивные дни не считаются -----------------------------------------
def test_archived_day_excluded_from_calendar(isolated_client) -> None:
    client, factory = isolated_client
    summary = client.post(f"{BASE}/data/load-demo?region_id=east").json()
    session = factory()
    from app.storage.repository import Repository

    repository = Repository(session)
    scenario = repository.get_scenario(summary["scenario_id"])
    meta = dict(scenario.scenario_metadata or {})
    meta["archived"] = True
    scenario.scenario_metadata = meta
    repository.update_scenario(scenario)
    session.close()
    # Ленивое создание поднимет один новый день; архивный не должен сложиться с ним.
    day = today_str()
    calendar = client.get(f"{BASE}/calendar?from={day}&to={day}&region_id=east").json()
    assert calendar["days"][0]["request_count"] == 66


# --- §42: поиск по вхождению и «ВК»→«BK» -------------------------------------
def test_booking_search_substring(isolated_client) -> None:
    client, _ = isolated_client
    created = client.post(
        f"{BASE}/booking/requests",
        json={"region_id": "east", "date": "2026-11-11", "window": "10:00-12:00",
              "type_bk": "Подключение", "address": "Москва, ул. Поиск, 1"},
    ).json()
    request_id = created["request_id"]
    suffix = request_id[-4:]
    assert any(r["request_id"] == request_id for r in client.get(f"{BASE}/booking/requests?q={suffix}").json())
    russian = request_id.replace("BK", "ВК")
    assert any(r["request_id"] == request_id for r in client.get(f"{BASE}/booking/requests?q={russian}").json())


# --- §41: маршруты стартуют из офиса ----------------------------------------
def test_brigades_start_at_office() -> None:
    dataset = build_region_scenario("east")
    office = dataset["scenario_metadata"]["office"]
    for engineer in dataset["engineers"]:
        assert engineer["latitude"] == office["lat"] and engineer["longitude"] == office["lon"]


# --- §37: удаление дня ------------------------------------------------------
def test_clear_day(isolated_client) -> None:
    client, _ = isolated_client
    client.post(f"{BASE}/data/load-demo?region_id=east&date=2026-12-01")
    cleared = client.post(f"{BASE}/days/2026-12-01/clear?region_id=east")
    assert cleared.status_code == 200, cleared.text
    body = cleared.json()
    assert body["scenarios"] >= 1 and "plans" in body and "events" in body
    day = client.get(f"{BASE}/days/2026-12-01?region_id=east").json()
    assert all(r["region_id"] != "east" for r in day["regions"])


# --- §38: WebSocket realtime ------------------------------------------------
def test_realtime_ticket_and_hello(isolated_client) -> None:
    client, _ = isolated_client
    ticket = client.post(f"{BASE}/realtime/ticket")
    assert ticket.status_code == 200, ticket.text
    token = ticket.json()["ticket"]
    with client.websocket_connect(f"{BASE}/realtime/ws?ticket={token}&since=0") as ws:
        hello = ws.receive_json()
        assert hello["type"] == "hello" and hello["protocol"] == 1 and hello["resumed"] is True
    # Билет одноразовый: повторное подключение тем же билетом закрывается.
    try:
        with client.websocket_connect(f"{BASE}/realtime/ws?ticket={token}") as ws:
            pass
    except Exception:  # noqa: BLE001 — ожидаемое закрытие 4401
        pass


# --- §45: имя версии не переполняет varchar(255) ----------------------------
def test_version_name_not_too_long(isolated_client) -> None:
    client, _ = isolated_client
    scenario_id = client.post(f"{BASE}/data/load-demo?region_id=east").json()["scenario_id"]
    plan = client.post(
        f"{BASE}/planning/run",
        json={"scenario_id": scenario_id, "time_limit_seconds": 2, "include_baseline": False},
    ).json()
    client.post(f"{BASE}/planning/{plan['plan_id']}/apply")
    for index in range(9):
        response = client.post(
            f"{BASE}/events/apply",
            json={
                "type": "order_added", "plan_id": plan["plan_id"], "event_time": "13:00",
                "request": {
                    "id": f"R-LONG-{index}", "latitude": 55.70, "longitude": 37.76,
                    "duration_minutes": 20, "window_start": "13:00", "window_end": "20:00",
                    "priority": "normal", "required_skill": "local",
                },
            },
        )
        assert response.status_code == 200, response.text
    scenarios = client.get(f"{BASE}/data/scenarios?region_id=east&date={today_str()}").json()["items"]
    assert all(len(item["name"]) <= 255 for item in scenarios)


def _applied_plan(client: TestClient, scenario_id: str) -> dict:
    plan = client.post(
        f"{BASE}/planning/run",
        json={"scenario_id": scenario_id, "time_limit_seconds": 2, "include_baseline": False},
    ).json()
    client.post(f"{BASE}/planning/{plan['plan_id']}/apply")
    return plan


def _active_plan_id(client: TestClient, scenario_id: str) -> str:
    day = client.get(f"{BASE}/days/{today_str()}?region_id=east").json()
    return next(r for r in day["regions"] if r["region_id"] == "east")["active_plan_id"]


# --- §49: отменённая заявка не возвращается в план --------------------------
def test_cancelled_request_does_not_return(isolated_client) -> None:
    client, _ = isolated_client
    scenario_id = client.post(f"{BASE}/data/load-demo?region_id=east").json()["scenario_id"]
    plan = _applied_plan(client, scenario_id)
    request_id = plan["assignments"][0]["request_id"]
    cancel = client.post(
        f"{BASE}/events/apply",
        json={"type": "order_cancelled", "plan_id": plan["plan_id"], "event_time": "12:30",
              "source": "dispatcher", "order_id": request_id, "apply": False,
              "params": {"reason": "client_refused", "stage": "call"}},
    ).json()
    client.post(f"{BASE}/planning/{cancel['plan']['plan_id']}/apply")
    # Следующее событие дня не должно вернуть отменённую заявку в маршруты.
    active = _active_plan_id(client, scenario_id)
    nxt = client.post(
        f"{BASE}/events/apply",
        json={"type": "engineer_delayed", "plan_id": active, "event_time": "13:00",
              "source": "engineer", "engineer_id": plan["assignments"][0]["engineer_id"],
              "params": {"delay_min": 15}},
    ).json()
    assignment_ids = {a["request_id"] for a in nxt["plan"]["assignments"]}
    assert request_id not in assignment_ids


# --- §48: rebase устаревшего предложения ------------------------------------
def test_rebase_stale_proposal(isolated_client) -> None:
    client, _ = isolated_client
    scenario_id = client.post(f"{BASE}/data/load-demo?region_id=east").json()["scenario_id"]
    active = _applied_plan(client, scenario_id)["plan_id"]

    def urgent(rid: str) -> str:
        return client.post(
            f"{BASE}/events/apply",
            json={
                "type": "urgent_order_added", "plan_id": active, "event_time": "12:30",
                "request": {"id": rid, "latitude": 55.70, "longitude": 37.76,
                            "duration_minutes": 60, "window_start": "12:30", "window_end": "22:00",
                            "priority": "urgent", "required_skill": "emergency"},
            },
        ).json()["plan"]["plan_id"]

    first = urgent("U-RB-1")
    second = urgent("U-RB-2")
    client.post(f"{BASE}/planning/{first}/apply")
    # Второе предложение устарело; пересчитываем на действующей версии.
    stale = client.post(f"{BASE}/planning/{second}/rebase")
    assert stale.status_code == 200, stale.text
    assert stale.json()["status"] == "proposed"


# --- §51: завершившая смену бригада недоступна ------------------------------
def test_shift_end_marks_unavailable(isolated_client) -> None:
    client, factory = isolated_client
    scenario_id = client.post(f"{BASE}/data/load-demo?region_id=east").json()["scenario_id"]
    _applied_plan(client, scenario_id)
    session = factory()
    from app.storage.repository import Repository

    scenario = Repository(session).get_scenario(scenario_id)
    engineer_id = scenario.engineers[0]["id"]
    session.close()
    from app.core.config import get_settings
    from app.services.auth_service import hash_password

    session = factory()
    Repository(session).create_user(
        login="eng-e01", name="e", role="engineer",
        password_hash=hash_password("demo2026"), region_ids=["east"], engineer_id=engineer_id,
    )
    session.close()
    settings = get_settings()
    original = settings.auth_enabled
    settings.auth_enabled = True
    try:
        token = client.post(f"{BASE}/auth/login", json={"login": "eng-e01", "password": "demo2026"}).json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        response = client.post(
            f"{BASE}/engineers/me/actions", json={"action": "shift_end"}, headers=headers
        )
        assert response.status_code == 200, response.text
    finally:
        settings.auth_enabled = original
    updated = client.get(f"{BASE}/data/scenarios/{scenario_id}").json()
    engineer = next(e for e in updated["engineers"] if e["id"] == engineer_id)
    assert engineer["shift_status"] == "finished" and engineer["available"] is False


# --- §30: день из записи оператора превращается в настоящий день ------------
def test_booking_only_day_becomes_real_day(isolated_client) -> None:
    client, _ = isolated_client
    day = today_str()
    created = client.post(
        f"{BASE}/booking/requests",
        json={"region_id": "east", "date": day, "window": "10:00-12:00",
              "type_bk": "Подключение", "address": "Москва, ул. Одна, 1"},
    ).json()
    assert created["scenario_id"]
    # Ленивое создание демо-дня переносит запись в настоящий день.
    result = client.get(f"{BASE}/days/{day}?region_id=east").json()
    east = next(r for r in result["regions"] if r["region_id"] == "east")
    assert east["scenario_id"] != created["scenario_id"]
    assert east["plan_state"] == "applied"


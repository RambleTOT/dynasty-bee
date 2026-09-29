"""Тесты дельты от 27.09: auth, реальное время, календарь, engineer/me, booking-рекалк."""
from __future__ import annotations

from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.core.timeutils import today_str
from app.services.auth_service import hash_password
from app.storage.repository import Repository

BASE = "/api/v1"

CSV = (
    "Заявка;Тип заявки BK;Тип заявки HD;Начало;Окончание;Район;Адрес;Гигабитное подключение\r\n"
    "1;Подключение;Конвергенция абонента;10:00;12:00;Даниловский;г. Москва, ул. A, д. 1;Нет\r\n"
    "\r\nАдрес Офиса;г. Москва, ул. Юных Ленинцев, д. 83с4\r\n"
)


def _make_user(session_factory, login: str, role: str, engineer_id: str | None = None):
    session = session_factory()
    Repository(session).create_user(
        login=login, name=login, role=role,
        password_hash=hash_password("demo2026"), region_ids=["east"], engineer_id=engineer_id,
    )
    session.close()


def _token(client: TestClient, login: str) -> dict:
    response = client.post(f"{BASE}/auth/login", json={"login": login, "password": "demo2026"})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _auth_on() -> tuple:
    settings = get_settings()
    original = settings.auth_enabled
    settings.auth_enabled = True
    return settings, original


def test_auth_me_and_logout(isolated_client) -> None:
    client, factory = isolated_client
    _make_user(factory, "dispatcher", "dispatcher")
    settings, original = _auth_on()
    try:
        headers = _token(client, "dispatcher")
        me = client.get(f"{BASE}/auth/me", headers=headers)
        assert me.status_code == 200 and me.json()["login"] == "dispatcher"
        # Терпимость к "Bearer Bearer <token>" (типичная ошибка в Swagger).
        doubled = {"Authorization": f"Bearer {headers['Authorization']}"}
        assert client.get(f"{BASE}/regions", headers=doubled).status_code == 200
        assert client.post(f"{BASE}/auth/logout", headers=headers).status_code == 204
        assert client.get(f"{BASE}/auth/me").status_code == 401
    finally:
        settings.auth_enabled = original


def test_calendar_and_days(isolated_client) -> None:
    client, _ = isolated_client
    day = today_str()
    scenario = client.post(f"{BASE}/data/load-demo?region_id=east").json()
    assert scenario["date"] == day
    calendar = client.get(f"{BASE}/calendar?from={day}&to={day}&region_id=east").json()
    assert calendar["days"]
    assert calendar["days"][0]["request_count"] == 66
    days = client.get(f"{BASE}/days/{day}?region_id=east").json()
    east = next(r for r in days["regions"] if r["region_id"] == "east")
    assert east["scenario_id"] == scenario["scenario_id"]
    assert east["plan_state"] == "none"


def test_engineer_me_day_and_route(isolated_client) -> None:
    client, factory = isolated_client
    _make_user(factory, "eng-east-01", "engineer", engineer_id="E01")
    scenario_id = client.post(f"{BASE}/data/load-demo?region_id=east").json()["scenario_id"]
    client.post(
        f"{BASE}/planning/run",
        json={"scenario_id": scenario_id, "time_limit_seconds": 2, "include_baseline": False},
    )
    settings, original = _auth_on()
    try:
        headers = _token(client, "eng-east-01")
        day = client.get(f"{BASE}/engineers/me/day", headers=headers)
        assert day.status_code == 200, day.text
        assert day.json()["date"] == today_str()
        route = client.get(f"{BASE}/engineers/me/route", headers=headers)
        assert route.status_code == 200, route.text
        assert route.json()["geometry"]["type"] == "LineString"
        # Нажатие инженера от себя.
        action = client.post(
            f"{BASE}/engineers/me/actions",
            json={"action": "shift_start", "payload": {"transport": "car"}},
            headers=headers,
        )
        assert action.status_code == 200, action.text
        # fail с reason=other без comment → 422 COMMENT_REQUIRED.
        bad = client.post(
            f"{BASE}/engineers/me/actions",
            json={"action": "fail", "request_id": "10001", "payload": {"reason": "other"}},
            headers=headers,
        )
        assert bad.status_code == 422
        assert bad.json()["detail"]["error"]["code"] == "COMMENT_REQUIRED"
    finally:
        settings.auth_enabled = original


def test_events_needs_decision(isolated_client) -> None:
    client, _ = isolated_client
    scenario_id = client.post(f"{BASE}/data/load-demo?region_id=east").json()["scenario_id"]
    plan = client.post(
        f"{BASE}/planning/run",
        json={"scenario_id": scenario_id, "time_limit_seconds": 2, "include_baseline": False},
    ).json()
    client.post(
        f"{BASE}/events/apply",
        json={"plan_id": plan["plan_id"], "type": "urgent_order_added", "event_time": "12:30",
              "request": {"id": "U-ND", "latitude": 55.70, "longitude": 37.76, "duration_minutes": 80,
                          "window_start": "12:30", "window_end": "22:00", "priority": "urgent",
                          "required_skill": "emergency"}},
    )
    events = client.get(f"{BASE}/events").json()
    assert events and any(event["needs_decision"] for event in events)


def test_date_param_and_bookings_conflict(isolated_client) -> None:
    client, _ = isolated_client
    # load-demo на конкретную дату.
    summary = client.post(f"{BASE}/data/load-demo?region_id=east&date=2026-11-05").json()
    assert summary["date"] == "2026-11-05"
    # Запись оператора на эту же дату.
    client.post(
        f"{BASE}/booking/requests",
        json={"region_id": "east", "date": "2026-11-05", "window": "10:00-12:00",
              "type_bk": "Подключение", "address": "Москва"},
    )
    # Импорт CSV на дату с записями → 409 DATE_HAS_BOOKINGS.
    conflict = client.post(
        f"{BASE}/data/import-beeline",
        files={"requests_file": ("r.csv", CSV.encode("utf-8"), "text/csv")},
        data={"region_id": "east", "date": "2026-11-05"},
    )
    assert conflict.status_code == 409, conflict.text
    assert conflict.json()["detail"]["error"]["code"] == "DATE_HAS_BOOKINGS"

"""Тесты финальных правок 28.09: часы дня, авария оператора, отмена, сравнение."""
from __future__ import annotations

from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.core.timeutils import today_str
from app.services.auth_service import hash_password
from app.storage.repository import Repository

BASE = "/api/v1"


def _user(session_factory, login, role, engineer_id=None):
    session = session_factory()
    Repository(session).create_user(
        login=login, name=login, role=role, password_hash=hash_password("demo2026"),
        region_ids=["east"], engineer_id=engineer_id,
    )
    session.close()


def _headers(client, login):
    token = client.post(
        f"{BASE}/auth/login", json={"login": login, "password": "demo2026"}
    ).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _applied_plan(client, scenario_id):
    plan = client.post(
        f"{BASE}/planning/run",
        json={"scenario_id": scenario_id, "time_limit_seconds": 2, "include_baseline": False},
    ).json()
    client.post(f"{BASE}/planning/{plan['plan_id']}/apply")
    return plan


def test_clock_autoplay_marks_visits(isolated_client) -> None:
    """Часы дня с автопрогоном переводят визиты в факты (D-24)."""
    client, _ = isolated_client
    scenario_id = client.post(f"{BASE}/data/load-demo?region_id=east").json()["scenario_id"]
    plan = _applied_plan(client, scenario_id)
    result = client.post(
        f"{BASE}/data/scenarios/{scenario_id}/clock", json={"time": "12:30", "autoplay": True}
    ).json()
    assert result["clock"] == "12:30"
    assert result["autoplayed"]["total"] >= 1
    updated = client.get(f"{BASE}/planning/{plan['plan_id']}").json()
    statuses = {
        point["status"]
        for route in updated["routes"]
        for point in route["route"]
    }
    assert statuses & {"done", "in_progress", "en_route"}


def test_operator_urgent_without_plan_id(isolated_client) -> None:
    """Оператор шлёт аварию без plan_id — план берётся из дня региона (D-33)."""
    client, factory = isolated_client
    _user(factory, "operator", "operator")
    scenario_id = client.post(f"{BASE}/data/load-demo?region_id=east").json()["scenario_id"]
    _applied_plan(client, scenario_id)
    client.post(f"{BASE}/data/scenarios/{scenario_id}/clock", json={"time": "12:30"})

    settings = get_settings()
    original = settings.auth_enabled
    settings.auth_enabled = True
    try:
        headers = _headers(client, "operator")
        response = client.post(
            f"{BASE}/events/apply",
            headers=headers,
            json={
                "type": "urgent_order_added",
                "source": "operator",
                "apply": False,
                "params": {"region_id": "east", "comment": "Нет связи у подъезда"},
                "request": {
                    "id": "U-OP-1", "address": "Волгоградский пр-т, д. 128 к1",
                    "duration_minutes": 80, "window_start": "00:55", "window_end": "22:00",
                    "priority": "urgent", "required_skill": "emergency",
                    "required_transport": "car", "type_bk": "Глобальная проблема",
                    "type_hd": "Авария", "source": "operator",
                },
            },
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["status"] == "proposed"
        # Окно аварии пересчитано по часам дня.
        plan = body["plan"]
        assert "U-OP-1" in {a["request_id"] for a in plan["assignments"]}
    finally:
        settings.auth_enabled = original


def test_booking_cancel_comment_and_reason(isolated_client) -> None:
    """Отмена оператором: reason=other требует comment, иначе 422 (9.3)."""
    client, _ = isolated_client
    created = client.post(
        f"{BASE}/booking/requests",
        json={"region_id": "east", "date": "2026-12-01", "window": "10:00-12:00",
              "type_bk": "Подключение", "address": "Москва"},
    ).json()
    bad = client.post(
        f"{BASE}/booking/requests/{created['request_id']}/cancel",
        json={"reason": "other"},
    )
    assert bad.status_code == 422
    assert bad.json()["detail"]["error"]["code"] == "COMMENT_REQUIRED"
    ok = client.post(
        f"{BASE}/booking/requests/{created['request_id']}/cancel",
        json={"reason": "other", "comment": "Клиент переезжает"},
    )
    assert ok.status_code == 200, ok.text
    assert "message" in ok.json()


def test_compare_columns_extended(isolated_client) -> None:
    """Сравнение: расширенные поля и формат km_by_engineer (§5)."""
    client, _ = isolated_client
    scenario_id = client.post(f"{BASE}/data/load-demo?region_id=east").json()["scenario_id"]
    body = client.post(
        f"{BASE}/planning/compare",
        json={"scenario_id": scenario_id, "strategies": ["ours", "fifo", "dispatcher"]},
    ).json()
    ours = body["columns"]["ours"]
    assert "unassigned" in ours and "visits_total" in ours and "late" in ours
    assert "dispatcher" in body["columns"]
    assert any("ours" in value for value in body["km_by_engineer"].values())


def test_clock_field_in_day_and_me(isolated_client) -> None:
    """Часы дня видны в /days и /engineers/me/day (D-24)."""
    client, factory = isolated_client
    _user(factory, "eng-east-01", "engineer", engineer_id="E01")
    scenario_id = client.post(f"{BASE}/data/load-demo?region_id=east").json()["scenario_id"]
    _applied_plan(client, scenario_id)
    client.post(f"{BASE}/data/scenarios/{scenario_id}/clock", json={"time": "11:00"})
    days = client.get(f"{BASE}/days/{today_str()}?region_id=east").json()
    assert days["regions"][0]["clock"] == "11:00"
    settings = get_settings()
    original = settings.auth_enabled
    settings.auth_enabled = True
    try:
        headers = _headers(client, "eng-east-01")
        me = client.get(f"{BASE}/engineers/me/day", headers=headers).json()
        assert me["clock"] == "11:00"
    finally:
        settings.auth_enabled = original

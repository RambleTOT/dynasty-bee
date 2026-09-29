"""Тесты перепланирования после событий."""
from __future__ import annotations

from fastapi.testclient import TestClient


def test_replan_urgent_request(client: TestClient, planned: dict) -> None:
    """Срочная заявка добавляется, план перестраивается, изменения возвращаются."""
    payload = {
        "plan_id": planned["plan_id"],
        "type": "urgent_request",
        "event_time": "14:30",
        "request": {
            "id": "R-EXTRA",
            "latitude": 55.76,
            "longitude": 37.63,
            "duration_minutes": 30,
            "window_start": "15:00",
            "window_end": "17:00",
            "priority": "urgent",
            "required_skill": "local",
        },
        "time_limit_seconds": 3,
        "seed": 11,
    }
    response = client.post("/api/v1/events/replan", json=payload)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["plan"]["kind"] == "replanned"
    assert body["applied_event"]["request_id"] == "R-EXTRA"
    assert body["plan"]["summary"]["total_requests"] == 9
    assert "change_summary" in body
    assert body["plan"]["parent_plan_id"] == planned["plan_id"]


def test_replan_engineer_unavailable(client: TestClient, planned: dict) -> None:
    """Недоступный инженер больше не получает заявок."""
    payload = {
        "plan_id": planned["plan_id"],
        "type": "engineer_unavailable",
        "engineer_id": "E2",
        "event_time": "13:00",
        "time_limit_seconds": 3,
        "seed": 12,
    }
    response = client.post("/api/v1/events/replan", json=payload)
    assert response.status_code == 200, response.text
    body = response.json()
    engineer_routes = {
        route["engineer_id"]: route for route in body["plan"]["routes"]
    }
    assert engineer_routes["E2"]["task_count"] == 0
    assert body["applied_event"]["engineer_id"] == "E2"


def test_replan_request_cancelled(client: TestClient, planned: dict) -> None:
    """Отменённая заявка исчезает из нового плана."""
    payload = {
        "plan_id": planned["plan_id"],
        "type": "request_cancelled",
        "request_id": "R6",
        "event_time": "13:30",
        "time_limit_seconds": 3,
        "seed": 13,
    }
    response = client.post("/api/v1/events/replan", json=payload)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["plan"]["summary"]["total_requests"] == 7
    assigned_ids = {assignment["request_id"] for assignment in body["plan"]["assignments"]}
    assert "R6" not in assigned_ids


def test_events_history(client: TestClient, planned: dict) -> None:
    """События перепланирования попадают в журнал."""
    response = client.get("/api/v1/events")
    assert response.status_code == 200
    events = response.json()
    assert len(events) >= 1
    assert {event["event_type"] for event in events} & {
        "urgent_request",
        "engineer_unavailable",
        "request_cancelled",
    }


def test_replan_unknown_engineer(client: TestClient, planned: dict) -> None:
    """Событие с несуществующим инженером возвращает 404."""
    payload = {
        "plan_id": planned["plan_id"],
        "type": "engineer_unavailable",
        "engineer_id": "NOPE",
    }
    response = client.post("/api/v1/events/replan", json=payload)
    assert response.status_code == 404

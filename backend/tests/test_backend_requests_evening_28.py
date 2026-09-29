"""Тесты правок из docs/BACKEND_REQUESTS_EVENING_28.md (на новом алгоритме)."""
from __future__ import annotations

from fastapi.testclient import TestClient

from app.core.timeutils import today_str
from app.storage.repository import Repository

BASE = "/api/v1"


def _applied(client: TestClient, scenario_id: str) -> dict:
    plan = client.post(
        f"{BASE}/planning/run",
        json={"scenario_id": scenario_id, "time_limit_seconds": 2, "include_baseline": False},
    ).json()
    client.post(f"{BASE}/planning/{plan['plan_id']}/apply")
    return plan


def _first_force_infeasible(client: TestClient, scenario: dict, plan: dict):
    """Ищет пару (заявка, инженер), переназначение которой нарушает ограничения."""
    engineers = {e["id"]: e for e in scenario["engineers"]}
    assigned = {}
    for route in plan["routes"]:
        for point in route["route"]:
            assigned[point["request_id"]] = route["engineer_id"]
    for request in scenario["requests"]:
        owner = assigned.get(request["id"])
        required = request.get("required_transport")
        if owner is None or not required:
            continue
        for engineer in scenario["engineers"]:
            if engineer["id"] == owner or engineer["transport"] == required:
                continue
            check = client.post(
                f"{BASE}/planning/{plan['plan_id']}/reassign/check",
                json={"order_id": request["id"], "to_engineer_id": engineer["id"]},
            )
            if check.status_code == 200 and not check.json()["feasible"]:
                return request["id"], engineer["id"]
    return None, None


# --- 25: день с нарушением не падает с 500 ----------------------------------
def test_violating_day_does_not_500(isolated_client) -> None:
    client, _ = isolated_client
    scenario_id = client.post(f"{BASE}/data/load-demo?region_id=east").json()["scenario_id"]
    scenario = client.get(f"{BASE}/data/scenarios/{scenario_id}").json()
    plan = _applied(client, scenario_id)

    request_id, engineer_id = _first_force_infeasible(client, scenario, plan)
    assert request_id, "не нашли недопустимую пару для force-переназначения"

    reassign = client.post(
        f"{BASE}/planning/{plan['plan_id']}/reassign",
        json={"order_id": request_id, "to_engineer_id": engineer_id, "force": True},
    )
    assert reassign.status_code == 200, reassign.text
    new_plan = reassign.json()["plan"]["plan_id"]
    applied = client.post(f"{BASE}/planning/{new_plan}/apply")
    assert applied.status_code == 200, applied.text

    # Раньше здесь был 500 ValueError: Infeasible route.
    check = client.post(
        f"{BASE}/planning/{new_plan}/reassign/check",
        json={"order_id": request_id, "to_engineer_id": engineer_id},
    )
    assert check.status_code != 500, check.text

    event = client.post(
        f"{BASE}/events/apply",
        json={
            "type": "order_added", "plan_id": new_plan, "event_time": "13:00",
            "request": {
                "id": "R-AFTER-VIOL", "latitude": 55.70, "longitude": 37.76,
                "duration_minutes": 30, "window_start": "13:00", "window_end": "20:00",
                "priority": "normal", "required_skill": "local",
            },
        },
    )
    assert event.status_code != 500, event.text

    booking = client.post(
        f"{BASE}/booking/requests",
        json={"region_id": "east", "date": today_str(), "window": "16:00-18:00",
              "type_bk": "Локальная заявка", "address": "Москва, ул. Нарушение, 1"},
    )
    assert booking.status_code != 500, booking.text


# --- 24: переназначение без позиции не встаёт перед замороженными -----------
def test_reassign_without_position_after_frozen(isolated_client) -> None:
    client, _ = isolated_client
    scenario_id = client.post(f"{BASE}/data/load-demo?region_id=east").json()["scenario_id"]
    scenario = client.get(f"{BASE}/data/scenarios/{scenario_id}").json()
    plan = _applied(client, scenario_id)
    client.post(
        f"{BASE}/data/scenarios/{scenario_id}/clock", json={"time": "13:00", "autoplay": True}
    )
    current = client.get(f"{BASE}/planning/{plan['plan_id']}").json()

    frozen_by_engineer = {
        route["engineer_id"]: sum(
            1 for p in route["route"] if p["status"] in {"done", "in_progress", "en_route"}
        )
        for route in current["routes"]
    }
    # Ищем инженера с замороженными визитами и чужую ещё не начатую заявку.
    target = next((eid for eid, n in frozen_by_engineer.items() if n > 0), None)
    assert target, "нет инженера с замороженными визитами"
    scenario_eng = {e["id"]: e for e in scenario["engineers"]}
    request_id = None
    for route in current["routes"]:
        for point in route["route"]:
            if point["status"] == "planned":
                # Совместим по навыку с target.
                req = next(r for r in scenario["requests"] if r["id"] == point["request_id"])
                if req["required_skill"] in scenario_eng[target]["skills"]:
                    request_id = point["request_id"]
                    break
        if request_id:
            break
    assert request_id, "нет подходящей запланированной заявки"

    result = client.post(
        f"{BASE}/planning/{plan['plan_id']}/reassign",
        json={"order_id": request_id, "to_engineer_id": target, "force": True},
    )
    assert result.status_code == 200, result.text

    moved_plan = result.json()["plan"]
    for route in moved_plan["routes"]:
        if route["engineer_id"] != target:
            continue
        if request_id in [p["request_id"] for p in route["route"]]:
            index = [p["request_id"] for p in route["route"]].index(request_id)
            frozen_before = sum(
                1 for p in route["route"][:index] if p["status"] in {"done", "in_progress", "en_route"}
            )
            assert frozen_before == frozen_by_engineer[target]
            assert index >= frozen_by_engineer[target]


# --- 26: ensure_demo_day игнорирует архивные сценарии -----------------------
def test_ensure_demo_day_ignores_archived(isolated_client) -> None:
    client, factory = isolated_client
    first = client.post(f"{BASE}/data/load-demo?region_id=east").json()
    session = factory()
    repository = Repository(session)
    scenario = repository.get_scenario(first["scenario_id"])
    metadata = dict(scenario.scenario_metadata or {})
    metadata["archived"] = True
    scenario.scenario_metadata = metadata
    repository.update_scenario(scenario)
    session.close()

    # Через API: ленивое создание должно поднять новый демо-день.
    day = client.get(f"{BASE}/days/{today_str()}?region_id=east").json()
    east = next(r for r in day["regions"] if r["region_id"] == "east")
    assert east["scenario_id"] != first["scenario_id"]
    assert east["plan_state"] == "applied"

"""Тесты сценариев перепланирования S0–S14."""
from __future__ import annotations

from fastapi.testclient import TestClient

from tests.conftest import SMALL_SCENARIO

BASE = "/api/v1"


def _load_and_plan(client: TestClient, scenario: dict | None = None, time_limit: float = 2.0) -> dict:
    """Загружает сценарий и запускает планирование."""
    loaded = client.post(f"{BASE}/data/load", json=scenario or SMALL_SCENARIO)
    assert loaded.status_code == 201, loaded.text
    planned = client.post(
        f"{BASE}/planning/run",
        json={
            "scenario_id": loaded.json()["scenario_id"],
            "time_limit_seconds": time_limit,
            "seed": 7,
            "include_baseline": True,
        },
    )
    assert planned.status_code == 200, planned.text
    return planned.json()


def _first_assigned(plan: dict) -> tuple[str, str]:
    """Возвращает (request_id, engineer_id) первой назначенной заявки."""
    assignment = plan["assignments"][0]
    return assignment["request_id"], assignment["engineer_id"]


def _apply(client: TestClient, plan_id: str, payload: dict) -> dict:
    """Применяет событие и возвращает результат."""
    response = client.post(f"{BASE}/events/apply", json={"plan_id": plan_id, **payload})
    assert response.status_code == 200, response.text
    return response.json()


def test_compare_strategies(client: TestClient) -> None:
    """S0: сравнение стратегий ours/fifo идёт, dispatcher пропускается без данных."""
    scenario = client.post(f"{BASE}/data/load", json=SMALL_SCENARIO).json()
    response = client.post(
        f"{BASE}/planning/compare",
        json={"scenario_id": scenario["scenario_id"], "strategies": ["ours", "fifo", "dispatcher"]},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert "ours" in body["columns"] and "fifo" in body["columns"]
    assert body["columns"].get("dispatcher", {}).get("available") is False
    assert body["notes"]


def test_urgent_order_added(client: TestClient) -> None:
    """S1: срочная заявка ставится в план, прошлое замораживается."""
    plan = _load_and_plan(client)
    result = _apply(
        client,
        plan["plan_id"],
        {
            "type": "urgent_order_added",
            "time": "12:00",
            "source": "dispatcher",
            "request": {
                "id": "R-URG",
                "latitude": 55.76,
                "longitude": 37.63,
                "duration_minutes": 30,
                "window_start": "12:00",
                "window_end": "17:00",
                "priority": "urgent",
                "required_skill": "emergency",
            },
        },
    )
    assert result["event_type"] == "urgent_order_added"
    assert result["plan"]["kind"] == "replanned"
    assert "urgent" in result["scenario"]
    ids = {a["request_id"] for a in result["plan"]["assignments"]}
    assert "R-URG" in ids


def test_order_cancelled(client: TestClient) -> None:
    """S3: отменённая заявка исчезает из плана."""
    plan = _load_and_plan(client)
    request_id, _ = _first_assigned(plan)
    result = _apply(
        client,
        plan["plan_id"],
        {
            "type": "order_cancelled",
            "time": "12:00",
            "source": "engineer",
            "order_id": request_id,
            "params": {"reason": "client_refused", "stage": "on_site"},
        },
    )
    assigned = {a["request_id"] for a in result["plan"]["assignments"]}
    assert request_id not in assigned
    assert result["scenario"]["cancelled"]["order_id"] == request_id


def test_engineer_unavailable(client: TestClient) -> None:
    """S4: недоступный инженер не получает заявок."""
    plan = _load_and_plan(client)
    _, engineer_id = _first_assigned(plan)
    result = _apply(
        client,
        plan["plan_id"],
        {
            "type": "engineer_unavailable",
            "time": "12:00",
            "source": "dispatcher",
            "engineer_id": engineer_id,
            "params": {"finish_current": True, "reason": "sick"},
        },
    )
    routes = {r["engineer_id"]: r for r in result["plan"]["routes"]}
    # Недоступный инженер не получает новых работ после времени события.
    for point in routes[engineer_id]["route"]:
        assert point["start"] <= "12:00"


def test_order_added(client: TestClient) -> None:
    """S5: новая обычная заявка добавляется в подходящий промежуток."""
    plan = _load_and_plan(client)
    result = _apply(
        client,
        plan["plan_id"],
        {
            "type": "order_added",
            "time": "12:00",
            "source": "client",
            "request": {
                "id": "R-NEW",
                "latitude": 55.75,
                "longitude": 37.62,
                "duration_minutes": 30,
                "window_start": "13:00",
                "window_end": "17:00",
                "priority": "normal",
                "required_skill": "local",
            },
        },
    )
    assert result["scenario"]["order_added"]["order_id"] == "R-NEW"


def test_engineer_delayed_and_finished_early(client: TestClient) -> None:
    """S6/S7: задержка и раннее завершение обрабатываются."""
    plan = _load_and_plan(client)
    _, engineer_id = _first_assigned(plan)
    delayed = _apply(
        client,
        plan["plan_id"],
        {
            "type": "engineer_delayed",
            "time": "12:00",
            "source": "engineer",
            "engineer_id": engineer_id,
            "params": {"where": "on_site", "delay_min": 30},
        },
    )
    assert delayed["scenario"]["engineer_delayed"]["delay_min"] == 30

    early = _apply(
        client,
        plan["plan_id"],
        {
            "type": "finished_early",
            "time": "12:00",
            "source": "engineer",
            "engineer_id": engineer_id,
            "params": {"actual_end": "11:30"},
        },
    )
    assert early["scenario"]["finished_early"]["engineer_id"] == engineer_id


def test_transport_changed(client: TestClient) -> None:
    """S9: смена транспорта пересчитывает хвост."""
    plan = _load_and_plan(client)
    _, engineer_id = _first_assigned(plan)
    result = _apply(
        client,
        plan["plan_id"],
        {
            "type": "transport_changed",
            "time": "12:00",
            "source": "engineer",
            "engineer_id": engineer_id,
            "params": {"transport": "walk"},
        },
    )
    routes = {r["engineer_id"]: r for r in result["plan"]["routes"]}
    assert routes[engineer_id]["transport"] == "walk"


def test_order_window_changed(client: TestClient) -> None:
    """S10: перенос окна клиентом."""
    plan = _load_and_plan(client)
    request_id, _ = _first_assigned(plan)
    result = _apply(
        client,
        plan["plan_id"],
        {
            "type": "order_window_changed",
            "time": "12:00",
            "source": "client",
            "order_id": request_id,
            "params": {"window_start": "13:00", "window_end": "17:00"},
        },
    )
    assert result["scenario"]["order_window_changed"]["order_id"] == request_id


def test_engineer_available(client: TestClient) -> None:
    """S11: вернувшийся инженер получает заявки."""
    plan = _load_and_plan(client)
    _, engineer_id = _first_assigned(plan)
    result = _apply(
        client,
        plan["plan_id"],
        {
            "type": "engineer_available",
            "time": "12:00",
            "source": "dispatcher",
            "engineer_id": engineer_id,
            "params": {"from": "12:00"},
        },
    )
    assert result["scenario"]["engineer_available"]["engineer_id"] == engineer_id


def test_order_scope_changed(client: TestClient) -> None:
    """S12: на месте нужно больше времени."""
    plan = _load_and_plan(client)
    request_id, _ = _first_assigned(plan)
    result = _apply(
        client,
        plan["plan_id"],
        {
            "type": "order_scope_changed",
            "time": "12:00",
            "source": "engineer",
            "order_id": request_id,
            "params": {"extra_min": 15},
        },
    )
    assert result["scenario"]["order_scope_changed"]["order_id"] == request_id


def test_reassign_check_and_apply(client: TestClient) -> None:
    """S2: проверка и применение ручного переназначения."""
    plan = _load_and_plan(client)
    request_id, current_engineer = _first_assigned(plan)
    other = next(
        r["engineer_id"] for r in plan["routes"] if r["engineer_id"] != current_engineer
    )
    check = client.post(
        f"{BASE}/planning/{plan['plan_id']}/reassign/check",
        json={"order_id": request_id, "to_engineer_id": other},
    )
    assert check.status_code == 200, check.text
    assert "checks" in check.json()

    applied = client.post(
        f"{BASE}/planning/{plan['plan_id']}/reassign",
        json={"order_id": request_id, "to_engineer_id": other, "force": True},
    )
    assert applied.status_code == 200, applied.text
    body = applied.json()
    assignment = next(
        a for a in body["plan"]["assignments"] if a["request_id"] == request_id
    )
    assert assignment["engineer_id"] == other


def test_suggest_for_idle(client: TestClient) -> None:
    """S8: подсказки для освободившегося инженера."""
    plan = _load_and_plan(client)
    _, engineer_id = _first_assigned(plan)
    response = client.post(
        f"{BASE}/planning/{plan['plan_id']}/suggest",
        json={"engineer_id": engineer_id, "from_time": "09:00", "to_time": "18:00"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["engineer_id"] == engineer_id


def test_extend_resource_and_what_if(client: TestClient) -> None:
    """S13/S14: добор ресурса и песочница."""
    plan = _load_and_plan(client)
    unassigned = [u["request_id"] for u in plan["unassigned"]]
    engineer_id = plan["routes"][0]["engineer_id"]

    extended = client.post(
        f"{BASE}/planning/{plan['plan_id']}/extend-resource",
        json={
            "order_ids": unassigned,
            "option": "extend_shift",
            "params": {"engineer_id": engineer_id, "extend_min": 60},
        },
    )
    assert extended.status_code == 200, extended.text
    assert "cost" in extended.json()

    what_if = client.post(
        f"{BASE}/planning/{plan['plan_id']}/what-if",
        json={
            "changes": [
                {"type": "shift_windows", "params": {"delta_min": 30}},
            ]
        },
    )
    assert what_if.status_code == 200, what_if.text
    assert "delta_metrics" in what_if.json()


def test_proposed_apply_reject(client: TestClient) -> None:
    """Средний уровень: версия proposed принимается или отклоняется."""
    plan = _load_and_plan(client)
    result = _apply(
        client,
        plan["plan_id"],
        {
            "type": "urgent_order_added",
            "time": "12:00",
            "apply": False,
            "request": {
                "id": "R-PROPOSED",
                "latitude": 55.76,
                "longitude": 37.63,
                "duration_minutes": 30,
                "window_start": "13:00",
                "window_end": "17:00",
                "priority": "urgent",
                "required_skill": "emergency",
            },
        },
    )
    assert result["status"] == "proposed"
    new_plan_id = result["plan"]["plan_id"]

    rejected = client.post(f"{BASE}/planning/{new_plan_id}/reject")
    assert rejected.status_code == 200
    assert rejected.json()["status"] == "rejected"

    applied = client.post(f"{BASE}/planning/{new_plan_id}/apply")
    assert applied.status_code == 200
    assert applied.json()["status"] == "applied"


def test_equipment_constraint(client: TestClient) -> None:
    """Max: отсутствие оборудования даёт NO_EQUIPMENT."""
    scenario = {
        "name": "Оборудование",
        "engineers": [
            {
                "id": "E1",
                "name": "Инженер",
                "latitude": 55.75,
                "longitude": 37.62,
                "shift_start": "09:00",
                "shift_end": "18:00",
                "skills": ["installation"],
                "transport": "car",
                "kit": {"router": 0},
            }
        ],
        "requests": [
            {
                "id": "R1",
                "latitude": 55.76,
                "longitude": 37.63,
                "duration_minutes": 30,
                "window_start": "10:00",
                "window_end": "12:00",
                "priority": "normal",
                "required_skill": "installation",
                "equipment": {"router": 1},
            }
        ],
    }
    plan = _load_and_plan(client, scenario)
    assert plan["unassigned"]
    assert plan["unassigned"][0]["reason_code"] == "NO_EQUIPMENT"


def test_legacy_replan_alias(client: TestClient) -> None:
    """Старый контракт /events/replan продолжает работать."""
    plan = _load_and_plan(client)
    response = client.post(
        f"{BASE}/events/replan",
        json={
            "plan_id": plan["plan_id"],
            "type": "urgent_request",
            "event_time": "12:00",
            "request": {
                "id": "R-LEGACY",
                "latitude": 55.76,
                "longitude": 37.63,
                "duration_minutes": 30,
                "window_start": "12:00",
                "window_end": "17:00",
                "priority": "urgent",
                "required_skill": "emergency",
            },
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["event_type"] == "urgent_order_added"

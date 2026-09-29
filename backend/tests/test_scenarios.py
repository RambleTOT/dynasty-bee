"""Сценарные тесты: разные размеры входных данных и обязательные ограничения."""
from __future__ import annotations

import random

import pytest
from fastapi.testclient import TestClient

from app.core.constants import (
    SKILL_EMERGENCY,
    SKILL_INSTALLATION,
    SKILL_LOCAL,
    TRANSPORT_BIKE,
    TRANSPORT_CAR,
    TRANSPORT_PUBLIC,
    TRANSPORT_WALK,
)
from app.schemas.validators import minutes_to_time, time_to_minutes

ALL_SKILLS = [SKILL_LOCAL, SKILL_INSTALLATION, SKILL_EMERGENCY]
ALL_TRANSPORTS = [TRANSPORT_CAR, TRANSPORT_WALK, TRANSPORT_BIKE, TRANSPORT_PUBLIC]


def make_scenario(
    n_engineers: int,
    n_requests: int,
    seed: int = 0,
    transports: list[str] | None = None,
    skills: list[str] | None = None,
) -> dict:
    """Генерирует детерминированный синтетический сценарий."""
    rng = random.Random(seed)
    transports = transports or ALL_TRANSPORTS
    skills = skills or ALL_SKILLS

    engineers = []
    for i in range(n_engineers):
        engineers.append(
            {
                "id": f"E{i:02d}",
                "name": f"Инженер {i}",
                "latitude": round(55.70 + rng.random() * 0.15, 6),
                "longitude": round(37.55 + rng.random() * 0.20, 6),
                "shift_start": "09:00",
                "shift_end": "18:00",
                "skills": rng.sample(skills, rng.randint(1, min(3, len(skills)))),
                "transport": transports[i % len(transports)],
            }
        )

    requests = []
    for j in range(n_requests):
        start = rng.randint(9 * 60, 16 * 60)
        end = min(start + rng.choice([60, 90, 120, 180]), 18 * 60)
        requests.append(
            {
                "id": f"R{j:03d}",
                "latitude": round(55.70 + rng.random() * 0.15, 6),
                "longitude": round(37.55 + rng.random() * 0.20, 6),
                "duration_minutes": rng.choice([20, 30, 45, 60]),
                "window_start": minutes_to_time(start),
                "window_end": minutes_to_time(end),
                "priority": rng.choice(["normal", "normal", "urgent"]),
                "required_skill": rng.choice(skills),
                "required_transport": rng.choice([None, None, rng.choice(transports)]),
            }
        )

    return {"name": f"Сценарий {n_engineers}x{n_requests}", "engineers": engineers, "requests": requests}


def _load_and_plan(client: TestClient, scenario: dict, time_limit: float = 2.0) -> dict:
    """Загружает сценарий и запускает планирование, возвращает ответ плана."""
    loaded = client.post("/api/v1/data/load", json=scenario)
    assert loaded.status_code == 201, loaded.text
    scenario_id = loaded.json()["scenario_id"]
    planned = client.post(
        "/api/v1/planning/run",
        json={
            "scenario_id": scenario_id,
            "time_limit_seconds": time_limit,
            "seed": 7,
            "include_baseline": True,
        },
    )
    assert planned.status_code == 200, planned.text
    return planned.json()


def assert_plan_is_consistent(scenario: dict, plan: dict) -> None:
    """Проверяет обязательные ограничения и целостность плана."""
    engineers = {item["id"]: item for item in scenario["engineers"]}
    requests = {item["id"]: item for item in scenario["requests"]}

    assigned_ids: list[str] = []
    for route in plan["routes"]:
        engineer = engineers[route["engineer_id"]]
        assert route["start_latitude"] is not None
        assert route["start_longitude"] is not None
        assert route["geometry_source"] is None or route["geometry_source"].startswith(
            ("openrouteservice", "straight_line", "osrm", "local_osrm", "mixed")
        )

        previous_end: int | None = None
        for sequence, point in enumerate(route["route"], start=1):
            request = requests[point["request_id"]]
            assigned_ids.append(point["request_id"])

            # Квалификация.
            assert request["required_skill"] in engineer["skills"]
            # Ресурс (тип транспорта).
            if request["required_transport"]:
                assert request["required_transport"] == engineer["transport"]
            # Время: начало работ в окне и в смену.
            window_start = time_to_minutes(point["window_start"])
            window_end = time_to_minutes(point["window_end"])
            start = time_to_minutes(point["start"])
            end = time_to_minutes(point["end"])
            assert window_start <= start <= window_end
            assert time_to_minutes(engineer["shift_start"]) <= start
            assert end <= time_to_minutes(engineer["shift_end"])
            # Согласованность времени и длительности.
            assert end - start == request["duration_minutes"]
            assert time_to_minutes(point["arrival"]) <= start
            if previous_end is not None:
                assert time_to_minutes(point["arrival"]) >= previous_end
            previous_end = end

            assert point["leg_distance_km"] >= 0
            assert point["travel_minutes"] >= 0

    unassigned_ids = [item["request_id"] for item in plan["unassigned"]]
    for item in plan["unassigned"]:
        assert item["reason"].strip()
        assert item["reason_code"]

    # Каждая заявка назначена ровно один раз или неназначена.
    assert sorted(assigned_ids + unassigned_ids) == sorted(requests)
    assert len(assigned_ids) == len(set(assigned_ids))

    summary = plan["summary"]
    assert summary["planned_count"] == len(assigned_ids)
    assert summary["unassigned_count"] == len(unassigned_ids)
    assert summary["total_requests"] == len(requests)
    active = len([route for route in plan["routes"] if route["task_count"] > 0])
    assert summary["engineers_used"] == active

    # Метрики и сравнение с базой.
    assert plan["metrics"] is not None
    assert plan["metrics"]["baseline"]["total_requests"] == len(requests)

    # Карта: линия на каждый непустой маршрут и точка на каждую заявку.
    features = plan["map_geojson"]["features"]
    lines = [f for f in features if f["geometry"]["type"] == "LineString"]
    points = [f for f in features if f["geometry"]["type"] == "Point"]
    assert len(lines) == active
    assert len(points) == len(engineers) + len(requests)
    for line in lines:
        # Прямая линия — ровно по точкам маршрута; дорожная — больше узлов.
        assert len(line["geometry"]["coordinates"]) >= line["properties"]["task_count"] + 1


@pytest.mark.parametrize(
    "n_engineers,n_requests,time_limit",
    [
        (1, 1, 1.0),
        (2, 3, 1.0),
        (5, 20, 2.0),
        (12, 45, 3.0),
        (15, 100, 3.0),
    ],
)
def test_planning_various_sizes(isolated_client, n_engineers, n_requests, time_limit) -> None:
    """Планирование работает и соблюдает ограничения на разных размерах."""
    client, _ = isolated_client
    scenario = make_scenario(n_engineers, n_requests, seed=n_engineers * 100 + n_requests)
    plan = _load_and_plan(client, scenario, time_limit=time_limit)
    assert_plan_is_consistent(scenario, plan)


def test_unassigned_when_no_skill(isolated_client) -> None:
    """Если навыка нет ни у кого, заявки неназначены с понятной причиной."""
    client, _ = isolated_client
    scenario = make_scenario(3, 5, seed=1, skills=[SKILL_LOCAL])
    for request in scenario["requests"]:
        request["required_skill"] = SKILL_EMERGENCY  # нет ни у одного инженера
    plan = _load_and_plan(client, scenario)
    assert plan["summary"]["planned_count"] == 0
    assert len(plan["unassigned"]) == 5
    assert all("навык" in item["reason"].lower() for item in plan["unassigned"])
    assert_plan_is_consistent(scenario, plan)


def test_unassigned_when_no_transport(isolated_client) -> None:
    """Если требуемого транспорта нет ни у кого, заявки неназначены."""
    client, _ = isolated_client
    scenario = make_scenario(3, 4, seed=2, transports=[TRANSPORT_WALK])
    for request in scenario["requests"]:
        request["required_transport"] = TRANSPORT_CAR  # автомобилей нет
    plan = _load_and_plan(client, scenario)
    assert plan["summary"]["planned_count"] == 0
    assert len(plan["unassigned"]) == 4
    assert all(item["reason"].strip() for item in plan["unassigned"])
    assert_plan_is_consistent(scenario, plan)


def test_replan_on_generated_scenario(isolated_client) -> None:
    """Перепланирование после срочной заявки работает на сгенерированных данных."""
    client, _ = isolated_client
    scenario = make_scenario(5, 20, seed=3)
    plan = _load_and_plan(client, scenario)
    response = client.post(
        "/api/v1/events/replan",
        json={
            "plan_id": plan["plan_id"],
            "type": "urgent_request",
            "event_time": "13:00",
            "request": {
                "id": "R-URGENT",
                "latitude": 55.76,
                "longitude": 37.63,
                "duration_minutes": 30,
                "window_start": "13:00",
                "window_end": "16:00",
                "priority": "urgent",
                "required_skill": SKILL_LOCAL,
            },
            "time_limit_seconds": 2,
            "seed": 5,
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["plan"]["kind"] == "replanned"
    assert body["plan"]["summary"]["total_requests"] == 21
    assert body["applied_event"]["request_id"] == "R-URGENT"
    # Геометрия маршрутов заполнена на чтении (у маршрутов с заявками).
    for route in body["plan"]["routes"]:
        if route["task_count"] == 0:
            continue
        assert route["geometry"] is not None
        assert route["geometry_source"] in {"straight_line"} or route[
            "geometry_source"
        ].startswith(("openrouteservice", "osrm", "local_osrm", "mixed"))

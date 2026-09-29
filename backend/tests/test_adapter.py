"""Тесты адаптера: преобразование API-данных в задачу алгоритма."""
from __future__ import annotations

from app.core.config import get_settings
from app.services.algorithm_adapter import AlgorithmAdapter
from tests.conftest import SMALL_SCENARIO


def _adapter() -> AlgorithmAdapter:
    settings = get_settings()
    return AlgorithmAdapter(settings.algorithm_dir, settings.road_factor, True)


def test_prepare_problem_builds_nodes_and_matrices() -> None:
    """Узлы, задачи и матрицы строятся согласованно."""
    problem = _adapter().prepare_problem(SMALL_SCENARIO["engineers"], SMALL_SCENARIO["requests"])

    # 4 инженера + 8 заявок = 12 узлов.
    assert len(problem.coordinates) == 12
    assert problem.engineer_node["E1"] == 0
    assert problem.request_node["R1"] == 4
    assert problem.node_kind[0] == "engineer_start"
    assert problem.node_kind[4] == "request"

    instance = problem.instance
    assert len(instance.tasks) == 8
    assert len(instance.engineers) == 4

    # На каждый транспорт инженера построены обе матрицы.
    transports = {engineer["transport"] for engineer in SMALL_SCENARIO["engineers"]}
    for transport in transports:
        assert transport in instance.travel_minutes
        assert transport in instance.distance_m
        assert instance.travel_minutes[transport].shape == (12, 12)


def test_required_transport_and_priority_mapped() -> None:
    """Требование по транспорту и приоритет переносятся в задачу алгоритма."""
    problem = _adapter().prepare_problem(SMALL_SCENARIO["engineers"], SMALL_SCENARIO["requests"])
    tasks = {task.id: task for task in problem.instance.tasks}
    assert tasks["R4"].transport == "car"
    assert tasks["R5"].urgent is True
    assert tasks["R1"].urgent is False


def test_russian_aliases_normalized() -> None:
    """Русские названия навыков и транспорта приводятся к каноническим ключам."""
    engineers = [
        {
            "id": "E9",
            "name": "Тестовый",
            "latitude": 55.75,
            "longitude": 37.62,
            "shift_start": "09:00",
            "shift_end": "18:00",
            "skills": ["Локальные работы", "Аварийные работы"],
            "transport": "Автомобиль",
        }
    ]
    requests = [
        {
            "id": "R9",
            "latitude": 55.76,
            "longitude": 37.63,
            "duration_minutes": 30,
            "window_start": "10:00",
            "window_end": "12:00",
            "priority": "Срочная",
            "required_skill": "Локальные работы",
            "required_transport": "Автомобиль",
        }
    ]
    problem = _adapter().prepare_problem(engineers, requests)
    assert problem.engineers[0]["skills"] == ["local", "emergency"]
    assert problem.engineers[0]["transport"] == "car"
    assert problem.requests[0]["priority"] == "urgent"
    assert problem.requests[0]["required_transport"] == "car"

"""Тесты загрузки и просмотра входных данных."""
from __future__ import annotations

from fastapi.testclient import TestClient

from tests.conftest import SMALL_SCENARIO


def test_health(client: TestClient) -> None:
    """Служебная проверка работоспособности и доступности алгоритма."""
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["algorithm_available"] is True
    assert body["database"] == "sqlite"


def test_root(client: TestClient) -> None:
    """Корневой маршрут отдаёт ссылки на документацию."""
    response = client.get("/")
    assert response.status_code == 200
    assert response.json()["docs"] == "/docs"


def test_openapi_contains_all_endpoints(client: TestClient) -> None:
    """Swagger/OpenAPI содержит обязательные маршруты кейса."""
    schema = client.get("/openapi.json").json()
    paths = schema["paths"]
    for expected in [
        "/api/v1/data/load",
        "/api/v1/planning/run",
        "/api/v1/planning/baseline",
        "/api/v1/events/replan",
        "/api/v1/visualization/{plan_id}/geojson",
    ]:
        assert expected in paths, f"Нет маршрута {expected}"


def test_load_and_get_scenario(client: TestClient, loaded_scenario: dict) -> None:
    """Загруженный сценарий сохраняется и читается обратно."""
    assert loaded_scenario["engineer_count"] == 4
    assert loaded_scenario["request_count"] == 8
    assert set(loaded_scenario["skills"]) == {"local", "installation", "emergency"}
    assert set(loaded_scenario["transports"]) == {"car", "bike", "walk", "public_transport"}

    scenario_id = loaded_scenario["scenario_id"]
    response = client.get(f"/api/v1/data/scenarios/{scenario_id}")
    assert response.status_code == 200
    body = response.json()
    assert len(body["engineers"]) == 4
    assert len(body["requests"]) == 8
    # Человекочитаемые названия заполнены.
    assert body["requests"][0]["required_skill_display"]


def test_scenarios_list_and_latest(client: TestClient, loaded_scenario: dict) -> None:
    """Список сценариев и последний сценарий доступны."""
    listing = client.get("/api/v1/data/scenarios").json()
    assert listing["count"] >= 1
    latest = client.get("/api/v1/data/latest")
    assert latest.status_code == 200


def test_load_rejects_unknown_transport(client: TestClient) -> None:
    """Неизвестный транспорт отклоняется с понятной ошибкой."""
    payload = {
        "engineers": [
            {
                "id": "X1",
                "name": "X",
                "latitude": 55.75,
                "longitude": 37.62,
                "shift_start": "09:00",
                "shift_end": "18:00",
                "skills": ["local"],
                "transport": "teleport",
            }
        ],
        "requests": SMALL_SCENARIO["requests"][:1],
    }
    response = client.post("/api/v1/data/load", json=payload)
    assert response.status_code == 422
    assert response.json()["code"] == "VALIDATION_ERROR"


def test_load_demo(client: TestClient) -> None:
    """Встроенный демонстрационный набор загружается."""
    response = client.post("/api/v1/data/load-demo")
    assert response.status_code == 201
    body = response.json()
    assert body["engineer_count"] == 12
    assert body["request_count"] == 45

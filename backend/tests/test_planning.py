"""Тесты запуска планирования, метрик, маршрутов и объяснений."""
from __future__ import annotations

from fastapi.testclient import TestClient


def test_planning_response_structure(planned: dict) -> None:
    """Ответ планирования содержит все обязательные блоки кейса."""
    assert planned["plan_id"]
    summary = planned["summary"]
    assert len(summary["objective"]) == 4
    assert summary["total_requests"] == 8
    assert summary["elapsed_seconds"] is not None
    assert len(planned["assignments"]) >= 1
    assert len(planned["explanations"]) == 8
    assert planned["map_geojson"]["type"] == "FeatureCollection"
    feature_types = {feature["properties"]["feature_type"] for feature in planned["map_geojson"]["features"]}
    assert "route" in feature_types or "request" in feature_types


def test_routes_have_map_fields(planned: dict) -> None:
    """Каждая точка маршрута содержит координаты и время прибытия."""
    non_empty = [route for route in planned["routes"] if route["task_count"] > 0]
    assert non_empty
    for route in non_empty:
        assert route["distance_km"] >= 0
        for point in route["route"]:
            assert "latitude" in point and "longitude" in point
            assert len(point["arrival"]) == 5  # HH:MM
            assert point["start"] and point["end"]


def test_explanations_explain_assignments(planned: dict) -> None:
    """Для назначенных заявок объяснение содержит учтённые ограничения."""
    assigned = [item for item in planned["explanations"] if item["status"] == "assigned"]
    assert assigned
    reasons = " ".join(assigned[0]["reasons"]).lower()
    assert "навыком" in reasons
    assert "окно" in reasons or "времен" in reasons


def test_unassigned_have_reasons(planned: dict) -> None:
    """Для всех неназначенных заявок есть явная причина."""
    for item in planned["unassigned"]:
        assert item["reason"]
        assert item["reason_code"]


def test_metrics_compared_with_baseline(planned: dict) -> None:
    """Метрики включают сравнение с базовым сценарием."""
    metrics = planned["metrics"]
    assert metrics is not None
    assert metrics["optimized"]["total_requests"] == 8
    assert metrics["baseline"]["total_requests"] == 8
    # Оптимизатор не может задействовать больше инженеров, чем базовый план.
    assert metrics["optimized"]["engineers_used"] <= metrics["baseline"]["engineers_used"]


def test_baseline_endpoint(client: TestClient, planned: dict) -> None:
    """Отдельный маршрут сравнения воспроизводит базовый план."""
    response = client.post("/api/v1/planning/baseline", json={"plan_id": planned["plan_id"]})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["comparison"]["baseline"]["total_requests"] == 8
    assert body["baseline_routes"]
    assert body["comparison"]["engineers_saved"] >= 0


def test_get_plan_and_explanations(client: TestClient, planned: dict) -> None:
    """План и объяснения читаются по ID."""
    plan_id = planned["plan_id"]
    full = client.get(f"/api/v1/planning/{plan_id}")
    assert full.status_code == 200
    assert full.json()["plan_id"] == plan_id

    explanations = client.get(f"/api/v1/planning/{plan_id}/explanations")
    assert explanations.status_code == 200
    assert len(explanations.json()) == 8


def test_geojson_endpoint(client: TestClient, planned: dict) -> None:
    """GeoJSON доступен для frontend."""
    response = client.get(f"/api/v1/visualization/{planned['plan_id']}/geojson")
    assert response.status_code == 200
    body = response.json()
    assert body["type"] == "FeatureCollection"
    assert body["metadata"]["road_factor"] > 1


def test_plans_list(client: TestClient, planned: dict) -> None:
    """Список планов доступен и содержит сохранённый план."""
    response = client.get("/api/v1/planning")
    assert response.status_code == 200
    body = response.json()
    assert body["count"] >= 1
    assert any(item["plan_id"] == planned["plan_id"] for item in body["items"])

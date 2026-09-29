"""Тесты карты: дорожная геометрия в GeoJSON и в ответе плана."""
from __future__ import annotations

from fastapi.testclient import TestClient

from app.api.deps import get_ors_client
from app.main import app
from app.services.ors_client import OpenRouteServiceClient, OrsRoute


class FakeOrsClient(OpenRouteServiceClient):
    """Клиент-заглушка, возвращающий предсказуемую дорожную геометрию."""

    def __init__(self) -> None:
        super().__init__(api_key="fake-key")

    def route_geometry(self, waypoints, profile, **kwargs):  # type: ignore[override]
        coordinates: list[list[float]] = []
        for index, (latitude, longitude) in enumerate(waypoints):
            coordinates.append([longitude, latitude])
            if index < len(waypoints) - 1:
                next_lat, next_lon = waypoints[index + 1]
                coordinates.append([(longitude + next_lon) / 2, (latitude + next_lat) / 2])
        return OrsRoute(profile=profile, coordinates=coordinates, distance_m=1000, duration_s=600)


def _with_fake_ors():
    fake = FakeOrsClient()
    app.dependency_overrides[get_ors_client] = lambda: fake
    return fake


def _lines(data: dict) -> list[dict]:
    return [f for f in data["features"] if f["geometry"]["type"] == "LineString"]


def test_geojson_contains_road_geometry(client: TestClient, planned: dict) -> None:
    """GeoJSON по умолчанию отдаёт дорожную геометрию маршрутов."""
    _with_fake_ors()
    try:
        response = client.get(f"/api/v1/visualization/{planned['plan_id']}/geojson")
        assert response.status_code == 200, response.text
        data = response.json()
        lines = _lines(data)
        assert lines
        for line in lines:
            # Общественный транспорт тоже идёт по дорогам (симуляция авто).
            assert line["properties"]["geometry_source"].startswith("openrouteservice")
            assert (
                len(line["geometry"]["coordinates"])
                > line["properties"]["task_count"] + 1
            )
        assert data["metadata"]["geometry_source"] == "openrouteservice"
    finally:
        app.dependency_overrides.pop(get_ors_client, None)


def test_geojson_straight_parameter(client: TestClient, planned: dict) -> None:
    """Параметр geometry=straight оставляет прямые отрезки."""
    response = client.get(
        f"/api/v1/visualization/{planned['plan_id']}/geojson?geometry=straight"
    )
    assert response.status_code == 200
    data = response.json()
    lines = _lines(data)
    assert lines
    for line in lines:
        assert line["properties"]["geometry_source"] == "straight_line"
        assert len(line["geometry"]["coordinates"]) == line["properties"]["task_count"] + 1
    assert data["metadata"]["geometry_source"] == "straight_line"


def test_plan_response_includes_geometry(client: TestClient, planned: dict) -> None:
    """Ответ /planning/{id} содержит дорожную геометрию каждого маршрута."""
    _with_fake_ors()
    try:
        response = client.get(f"/api/v1/planning/{planned['plan_id']}?geometry=road")
        assert response.status_code == 200, response.text
        routes = response.json()["routes"]
        assert routes
        for route in routes:
            assert route["start_latitude"] is not None
            if route["task_count"] == 0:
                continue
            assert route["geometry"] is not None
            assert route["geometry_source"].startswith("openrouteservice")
    finally:
        app.dependency_overrides.pop(get_ors_client, None)


def test_plan_response_map_geojson_enriched(client: TestClient, planned: dict) -> None:
    """Встроенный map_geojson в ответе плана тоже содержит дорожную геометрию."""
    _with_fake_ors()
    try:
        response = client.get(f"/api/v1/planning/{planned['plan_id']}?geometry=road")
        assert response.status_code == 200, response.text
        geojson = response.json()["map_geojson"]
        assert geojson["metadata"]["geometry_source"] == "openrouteservice"
        for line in _lines(geojson):
            assert line["properties"]["geometry_source"].startswith("openrouteservice")
    finally:
        app.dependency_overrides.pop(get_ors_client, None)


def test_map_page_uses_geometry_parameter(client: TestClient, planned: dict) -> None:
    """HTML-карта запрашивает GeoJSON с нужным режимом геометрии."""
    response = client.get(
        f"/api/v1/visualization/{planned['plan_id']}/map?geometry=straight"
    )
    assert response.status_code == 200
    assert "geojson?geometry=straight" in response.text

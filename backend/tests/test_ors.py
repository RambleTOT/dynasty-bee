"""Тесты расчёта матриц: OpenRouteService, чанкование, кэш и резервный режим."""
from __future__ import annotations

import pytest

from app.schemas.plan import RouteOut, RoutePoint
from app.services.geo import build_matrices, build_math_distance_matrix
from app.services.local_osrm import LocalOsrmClient, OsrmError
from app.services.ors_client import OpenRouteServiceClient, OrsError, OrsRoute
from app.services.route_service import attach_route_geometry, enrich_geojson_geometry

_COORDS = [(55.75, 37.62), (55.76, 37.63), (55.77, 37.64)]


def test_math_matrix_for_non_car() -> None:
    """walk/bike/public_transport считаются математикой (без OSRM)."""
    bundle = build_matrices(_COORDS, {"car", "walk", "bike", "public_transport"}, road_factor=1.28)
    assert bundle.sources["walk"] == "math:walk"
    assert bundle.sources["bike"] == "math:bike"
    assert bundle.sources["public_transport"] == "math:public_transport"
    # Матрица совпадает с гаверсинусом × 1.3.
    expected = build_math_distance_matrix(_COORDS)
    assert bundle.distance_m["walk"] == expected
    assert bundle.distance_m["bike"] == expected
    assert bundle.distance_m["public_transport"] == expected
    assert bundle.warnings == []


def test_local_osrm_used_for_car(monkeypatch) -> None:
    """Для car используется матрица локального OSRM."""
    from app.services.local_osrm import OsrmTable

    class FakeLocal:
        def table(self, coordinates):
            size = len(coordinates)
            return OsrmTable(
                distance_m=[[7] * size for _ in range(size)],
                duration_min=[[3] * size for _ in range(size)],
            )

    bundle = build_matrices(_COORDS, {"car", "walk"}, road_factor=1.28, local_osrm=FakeLocal())
    assert bundle.sources["car"] == "local_osrm:car"
    assert bundle.distance_m["car"][0][1] == 7
    assert bundle.travel_minutes["car"][0][1] == 3


def test_local_osrm_table_chunked_indices(monkeypatch) -> None:
    """Блочная матрица корректно сопоставляет источники/назначения (>50 узлов)."""
    client = LocalOsrmClient(base_url="http://x", table_chunk_size=2)

    def fake_get(path, params):
        coords_str = path.split("/table/v1/driving/")[1]
        locations = [[float(v) for v in c.split(",")] for c in coords_str.split(";")]
        srcs = [int(v) for v in params["sources"].split(";")]
        dsts = [int(v) for v in params["destinations"].split(";")]
        distances, durations = [], []
        for i in srcs:
            row_d, row_t = [], []
            for j in dsts:
                d = abs(locations[i][0] - locations[j][0]) * 1000.0
                row_d.append(d)
                row_t.append(d / 10.0)
            distances.append(row_d)
            durations.append(row_t)
        return {"code": "Ok", "distances": distances, "durations": durations}

    monkeypatch.setattr(client, "_get", fake_get)
    coords = [(55.70, 37.60), (55.71, 37.70), (55.72, 37.80)]
    table = client.table(coords)
    assert table.distance_m[0][1] == 100
    assert table.distance_m[0][2] == 200
    assert table.distance_m[1][2] == 100
    assert table.duration_min[0][1] == 1  # 10 c → 1 мин


def test_fallback_without_osrm() -> None:
    """Без локального OSRM и ORS: car — по прямой, остальные — математика."""
    bundle = build_matrices(_COORDS, {"car", "public_transport"}, road_factor=1.28)
    assert set(bundle.distance_m) == {"car", "public_transport"}
    assert bundle.sources["car"] == "straight_line_estimate"
    assert bundle.sources["public_transport"] == "math:public_transport"
    assert bundle.distance_m["car"][0][0] == 0
    assert bundle.distance_m["car"][0][1] > 0
    assert bundle.distance_m["public_transport"][0][1] > 0


def test_local_osrm_client_table_and_route(monkeypatch) -> None:
    """Клиент локального OSRM парсит /table и /route, кэширует результат."""
    client = LocalOsrmClient(base_url="http://localhost:5000")
    calls: list[str] = []

    def fake_get(path, params):
        calls.append(path)
        if "/table/" in path:
            return {
                "code": "Ok",
                "durations": [[0, 120], [180, 0]],
                "distances": [[0, 1000], [1500, 0]],
            }
        return {
            "code": "Ok",
            "routes": [
                {
                    "geometry": {"coordinates": [[37.6, 55.7], [37.61, 55.71]]},
                    "distance": 1000.0,
                    "duration": 120.0,
                }
            ],
        }

    monkeypatch.setattr(client, "_get", fake_get)
    table = client.table([(55.7, 37.6), (55.71, 37.61)])
    assert table.distance_m[0][1] == 1000
    assert table.duration_min[0][1] == 2
    route = client.route([(55.7, 37.6), (55.71, 37.61)])
    assert route[0] == [[37.6, 55.7], [37.61, 55.71]]
    assert route[1] == 1000.0
    calls_before = len(calls)
    client.table([(55.7, 37.6), (55.71, 37.61)])
    client.route([(55.7, 37.6), (55.71, 37.61)])
    assert len(calls) == calls_before  # кэш


def test_ors_matrix_chunking_and_cache(monkeypatch) -> None:
    """Матрица собирается из блоков, единицы переводятся, работает LRU-кэш."""
    client = OpenRouteServiceClient(api_key="test-key", chunk_size=2, cache_size=2)
    calls: list[str] = []

    def fake_post(url: str, payload: dict) -> dict:
        calls.append(url)
        rows = len(payload["sources"])
        columns = len(payload["destinations"])
        return {
            "distances": [[100.0] * columns for _ in range(rows)],
            "durations": [[120.0] * columns for _ in range(rows)],
        }

    monkeypatch.setattr(client, "_post_json", fake_post)
    matrix = client.matrix(_COORDS, "driving-car")

    # 3 узла при размере блока 2 → 2×2 = 4 блока.
    assert len(calls) == 4
    assert matrix.distance_m[0][1] == 100
    assert matrix.distance_m[0][0] == 0
    assert matrix.duration_min[0][1] == 2  # 120 секунд → 2 минуты

    # Повторный вызов обслуживается кэшем.
    client.matrix(_COORDS, "driving-car")
    assert len(calls) == 4


def test_ors_client_reports_unavailable_transport() -> None:
    """Общественный транспорт не имеет профиля ORS."""
    client = OpenRouteServiceClient(api_key="test-key")
    assert client.profile_for("car") == "driving-car"
    assert client.profile_for("bike") == "cycling-regular"
    assert client.profile_for("walk") == "foot-walking"
    assert client.profile_for("public_transport") is None


def test_geometry_profile_public_transport_uses_car() -> None:
    """Для геометрии ОТ берём автомобильный профиль, для матриц — по-прежнему None."""
    client = OpenRouteServiceClient(api_key="test-key")
    assert client.geometry_profile_for("public_transport") == "driving-car"
    assert client.geometry_profile_for("car") == "driving-car"
    assert client.profile_for("public_transport") is None


def test_rate_limit_circuit_breaker(monkeypatch) -> None:
    """При активном cooldown матрица не обращается к ORS (сразу ошибка)."""
    import time as _time

    client = OpenRouteServiceClient(api_key="test-key")
    client._rate_limited_until = _time.monotonic() + 60
    calls: list[str] = []
    monkeypatch.setattr(client, "_post_json", lambda url, payload: calls.append(url))
    with pytest.raises(OrsError):
        client.matrix([(55.0, 37.0), (55.1, 37.1)], "driving-car")
    assert calls == []


def test_geometry_falls_back_when_providers_unavailable(monkeypatch) -> None:
    """Если ORS в cooldown и OSRM отключён — геометрия собирается прямыми."""
    import time as _time

    client = OpenRouteServiceClient(api_key="test-key", osrm_enabled=False)
    client._rate_limited_until = _time.monotonic() + 60
    route = client.route_geometry(
        [(55.0, 37.0), (55.1, 37.1), (55.2, 37.2)], "driving-car"
    )
    # Прямые по узлам: 2 + 1 стык = 3 точки.
    assert len(route.coordinates) == 3


def test_osrm_fallback_provider(monkeypatch) -> None:
    """Если ORS недоступен, геометрия берётся из OSRM (источник = osrm)."""
    client = OpenRouteServiceClient(api_key="test-key")

    def ors_down(waypoints, profile):
        raise OrsError("ORS недоступен")

    def osrm_ok(waypoints, profile):
        return [[37.0, 55.0], [37.1, 55.1]], 1000.0, 60.0

    monkeypatch.setattr(client, "_directions", ors_down)
    monkeypatch.setattr(client, "_osrm_directions", osrm_ok)
    route = client.route_geometry([(55.0, 37.0), (55.1, 37.1)], "driving-car", transport="car")
    assert route.provider == "osrm"
    assert len(route.coordinates) == 2


def test_public_transport_duration_formula(monkeypatch) -> None:
    """Для ОТ берём геометрию, а дистанцию/время считаем математикой (не из ORS)."""
    from app.core.constants import MATH_ROAD_FACTOR, math_travel_minutes
    from app.services.ors_client import _path_km

    client = OpenRouteServiceClient(api_key="test-key")

    def fake_post(url: str, payload: dict) -> dict:
        return {
            "features": [
                {
                    "geometry": {"type": "LineString", "coordinates": [[37.0, 55.0], [37.1, 55.1]]},
                    "properties": {"summary": {"distance": 12000.0, "duration": 99999.0}},
                }
            ]
        }

    monkeypatch.setattr(client, "_post_json", fake_post)
    waypoints = [(55.0, 37.0), (55.1, 37.1)]
    route = client.route_geometry(waypoints, "driving-car", transport="public_transport")
    expected_km = _path_km(waypoints) * MATH_ROAD_FACTOR
    assert route.distance_m == int(round(expected_km * 1000))
    assert route.duration_s == math_travel_minutes(expected_km, "public_transport") * 60
    # Геометрия — от провайдера, время ORS (99999) проигнорировано.
    assert len(route.coordinates) == 2


def test_route_geometry_builds_road_line_and_caches(monkeypatch) -> None:
    """Directions API возвращает дорожный полилайн, результат кэшируется."""
    client = OpenRouteServiceClient(api_key="test-key")
    calls: list[str] = []

    def fake_post(url: str, payload: dict) -> dict:
        calls.append(url)
        line: list[list[float]] = []
        for lon, lat in payload["coordinates"]:
            line.append([lon, lat])
            line.append([lon + 0.0001, lat + 0.0001])
        return {
            "features": [
                {
                    "geometry": {"type": "LineString", "coordinates": line},
                    "properties": {"summary": {"distance": 1000.0, "duration": 600.0}},
                }
            ]
        }

    monkeypatch.setattr(client, "_post_json", fake_post)
    route = client.route_geometry(_COORDS, "driving-car")

    assert len(calls) == 1
    assert route.profile == "driving-car"
    assert len(route.coordinates) == 6  # по 2 точки на waypoint
    assert route.distance_m == 1000
    assert route.duration_s == 600

    # Повторный вызов берётся из кэша.
    client.route_geometry(_COORDS, "driving-car")
    assert len(calls) == 1


def test_route_geometry_chunks_over_waypoint_limit(monkeypatch) -> None:
    """Маршрут длиннее лимита ORS запрашивается частями и склеивается."""
    client = OpenRouteServiceClient(api_key="test-key")
    calls: list[str] = []

    def fake_post(url: str, payload: dict) -> dict:
        calls.append(url)
        line = [list(coord) for coord in payload["coordinates"]]
        return {
            "features": [
                {
                    "geometry": {"type": "LineString", "coordinates": line},
                    "properties": {"summary": {"distance": 500.0, "duration": 300.0}},
                }
            ]
        }

    monkeypatch.setattr(client, "_post_json", fake_post)
    waypoints = [(55.75 + i * 0.001, 37.62 + i * 0.001) for i in range(60)]
    route = client.route_geometry(waypoints, "driving-car")

    assert len(calls) == 2  # 50 + 11 waypoint с перекрытием
    assert route.distance_m == 1000  # 2 сегмента × 500 м
    # Точки стыка не дублируются: 60 точек ровно.
    assert len(route.coordinates) == 60


def test_route_geometry_requires_two_points() -> None:
    """Для геометрии нужно минимум две точки."""
    client = OpenRouteServiceClient(api_key="test-key")
    with pytest.raises(OrsError):
        client.route_geometry([(55.75, 37.62)], "driving-car")


def test_route_geometry_leg_by_leg_fallback(monkeypatch) -> None:
    """Если целый маршрут не снапится, строим посегментно (дорога + прямые)."""
    client = OpenRouteServiceClient(api_key="test-key", osrm_enabled=False)

    def fake_directions(waypoints, profile):
        if len(waypoints) > 2:
            raise OrsError("snap failed")
        start, end = waypoints
        return (
            [[start[1], start[0]], [end[1], end[0]]],
            100.0,
            60.0,
        )

    monkeypatch.setattr(client, "_directions", fake_directions)
    route = client.route_geometry(
        [(55.0, 37.0), (55.1, 37.1), (55.2, 37.2)], "driving-car"
    )
    # 2 ребра по 2 точки, стык второго ребра убран → 3 точки.
    assert len(route.coordinates) == 3
    assert route.distance_m == 200


def _sample_route(transport: str = "car") -> RouteOut:
    """Маршрут из одной заявки для проверки обогащения геометрией."""
    return RouteOut(
        engineer_id="E1",
        engineer_name="Инженер",
        transport=transport,
        transport_display="Автомобиль",
        skills=["local"],
        skills_display=["Локальные работы"],
        shift_start="09:00",
        shift_end="18:00",
        start_latitude=55.75,
        start_longitude=37.62,
        distance_km=1.0,
        task_count=1,
        route=[
            RoutePoint(
                request_id="R1",
                sequence=1,
                latitude=55.76,
                longitude=37.63,
                arrival="10:00",
                start="10:00",
                end="10:30",
                travel_minutes=5,
                leg_distance_km=1.0,
                waiting_minutes=0,
                window_start="10:00",
                window_end="11:00",
                required_skill="local",
                required_skill_display="Локальные работы",
            )
        ],
    )


def test_attach_route_geometry_uses_ors(monkeypatch) -> None:
    """При доступном ORS маршрут получает дорожную геометрию."""
    client = OpenRouteServiceClient(api_key="test-key")
    monkeypatch.setattr(
        client,
        "route_geometry",
        lambda waypoints, profile, **kwargs: OrsRoute(
            profile=profile,
            coordinates=[[37.62, 55.75], [37.625, 55.755], [37.63, 55.76]],
            distance_m=1234,
            duration_s=321,
        ),
    )
    route = attach_route_geometry([_sample_route()], client)[0]
    assert route.geometry_source == "openrouteservice:driving-car"
    assert len(route.geometry) == 3


def test_attach_route_geometry_public_transport_uses_car(monkeypatch) -> None:
    """Для общественного транспорта геометрия автомобильная (симуляция)."""
    client = OpenRouteServiceClient(api_key="test-key")
    monkeypatch.setattr(
        client,
        "route_geometry",
        lambda waypoints, profile, **kwargs: OrsRoute(
            profile=profile,
            coordinates=[[37.62, 55.75], [37.63, 55.76]],
            distance_m=12000,
            duration_s=99999,
        ),
    )
    route = attach_route_geometry([_sample_route("public_transport")], client)[0]
    assert route.geometry_source == "openrouteservice:driving-car+public_transport"
    assert len(route.geometry) == 2


def test_attach_route_geometry_falls_back_on_error(monkeypatch) -> None:
    """При сбое ORS используется прямая линия и явная пометка."""
    client = OpenRouteServiceClient(api_key="test-key")

    def boom(waypoints, profile, **kwargs):
        raise OrsError("ORS недоступен")

    monkeypatch.setattr(client, "route_geometry", boom)
    route = attach_route_geometry([_sample_route()], client)[0]
    assert route.geometry_source == "straight_line"
    assert route.geometry == [[37.62, 55.75], [37.63, 55.76]]


def test_attach_route_geometry_without_client() -> None:
    """Без клиента ORS геометрия — прямые отрезки."""
    route = attach_route_geometry([_sample_route("public_transport")], None)[0]
    assert route.geometry_source == "straight_line"
    assert len(route.geometry) == 2


def _sample_geojson(transport: str = "car") -> dict:
    """Мини-GeoJSON с одной линией маршрута и точкой."""
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[37.62, 55.75], [37.63, 55.76]],
                },
                "properties": {
                    "feature_type": "route",
                    "engineer_id": "E1",
                    "transport": transport,
                    "geometry_source": "straight_line",
                },
            },
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [37.63, 55.76]},
                "properties": {"feature_type": "request", "request_id": "R1"},
            },
        ],
        "metadata": {"geometry_source": "straight_line"},
    }


def test_enrich_geojson_uses_ors(monkeypatch) -> None:
    """Линия GeoJSON заменяется дорожной геометрией."""
    client = OpenRouteServiceClient(api_key="test-key")
    monkeypatch.setattr(
        client,
        "route_geometry",
        lambda waypoints, profile, **kwargs: OrsRoute(
            profile=profile,
            coordinates=[[37.62, 55.75], [37.625, 55.755], [37.63, 55.76]],
            distance_m=1,
            duration_s=1,
        ),
    )
    geojson = enrich_geojson_geometry(_sample_geojson(), client, mode="road")
    line = geojson["features"][0]
    assert line["properties"]["geometry_source"] == "openrouteservice:driving-car"
    assert len(line["geometry"]["coordinates"]) == 3
    assert geojson["metadata"]["geometry_source"] == "openrouteservice"


def test_enrich_geojson_straight_mode_keeps_lines() -> None:
    """Режим straight не обращается к ORS и оставляет прямые отрезки."""
    client = OpenRouteServiceClient(api_key="test-key")
    geojson = enrich_geojson_geometry(_sample_geojson(), client, mode="straight")
    line = geojson["features"][0]
    assert line["geometry"]["coordinates"] == [[37.62, 55.75], [37.63, 55.76]]
    assert line["properties"]["geometry_source"] == "straight_line"
    assert geojson["metadata"]["geometry_source"] == "straight_line"

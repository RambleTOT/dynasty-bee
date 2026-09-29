"""Сервис построения маршрутов и данных для карты.

Преобразует отчёт алгоритма (индексы заявок, расписание) в формат, удобный
для frontend: точки с координатами, временем прибытия и пробегом, а также
GeoJSON для Leaflet/OpenStreetMap.
"""
from __future__ import annotations

import logging
from typing import Any

from app.core.constants import skill_display, transport_display
from app.schemas.plan import AssignmentOut, RouteOut, RoutePoint
from app.schemas.validators import safe_time_to_minutes
from app.services.algorithm_adapter import AdaptedProblem
from app.services.ors_client import OpenRouteServiceClient, OrsError

logger = logging.getLogger(__name__)

# Палитра для маршрутов инженеров на карте.
ROUTE_COLORS = [
    "#1f77b4",
    "#ff7f0e",
    "#2ca02c",
    "#d62728",
    "#9467bd",
    "#8c564b",
    "#e377c2",
    "#7f7f7f",
    "#bcbd22",
    "#17becf",
]


def report_to_index_routes(problem: AdaptedProblem, report: dict[str, Any]) -> list[tuple[int, ...]]:
    """Переводит маршруты отчёта (ID заявок) в кортежи индексов задач."""
    request_index = {request["id"]: index for index, request in enumerate(problem.requests)}
    routes: list[tuple[int, ...]] = []
    for route in report.get("routes", []):
        routes.append(tuple(request_index[task_id] for task_id in route.get("task_ids", [])))
    return routes


def build_routes(problem: AdaptedProblem, report: dict[str, Any]) -> list[RouteOut]:
    """Собирает маршруты инженеров с точками для карты."""
    request_by_id = problem.request_by_id
    routes: list[RouteOut] = []
    for entry in report.get("routes", []):
        engineer_id = entry["engineer_id"]
        engineer = problem.engineer_by_id[engineer_id]
        points: list[RoutePoint] = []
        for sequence, row in enumerate(entry.get("schedule", []), start=1):
            request = request_by_id[row["task_id"]]
            slack = safe_time_to_minutes(request["window_end"]) - safe_time_to_minutes(row["start"])
            flags: list[str] = []
            if request.get("priority") == "urgent":
                flags.append("urgent")
            if slack < 0:
                flags.append("late")
            elif slack < 15:
                flags.append("at_risk")
            points.append(
                RoutePoint(
                    request_id=request["id"],
                    sequence=sequence,
                    latitude=request["latitude"],
                    longitude=request["longitude"],
                    address=request.get("address"),
                    arrival=row["arrival"],
                    start=row["start"],
                    end=row["end"],
                    travel_minutes=int(row.get("travel_minutes", 0)),
                    leg_distance_km=round(int(row.get("leg_metres", 0)) / 1000, 3),
                    waiting_minutes=int(row.get("waiting_minutes", 0)),
                    window_start=request["window_start"],
                    window_end=request["window_end"],
                    required_skill=request["required_skill"],
                    required_skill_display=skill_display(request["required_skill"]),
                    status="planned",
                    flags=flags,
                    slack_minutes=slack,
                    frozen=False,
                    actual_arrival=row.get("actual_arrival"),
                    actual_start=row.get("actual_start"),
                    actual_end=row.get("actual_end"),
                )
            )
        routes.append(
            RouteOut(
                engineer_id=engineer_id,
                engineer_name=engineer.get("name", engineer_id),
                transport=engineer["transport"],
                transport_display=transport_display(engineer["transport"]),
                skills=list(engineer["skills"]),
                skills_display=[skill_display(s) for s in engineer["skills"]],
                shift_start=engineer["shift_start"],
                shift_end=engineer["shift_end"],
                start_latitude=engineer["latitude"],
                start_longitude=engineer["longitude"],
                distance_km=round(float(entry.get("distance_km", 0.0)), 3),
                task_count=len(points),
                route=points,
                explanation=entry.get("explanation", ""),
            )
        )
    return routes


def build_assignments(problem: AdaptedProblem, report: dict[str, Any]) -> list[AssignmentOut]:
    """Собирает плоский список назначений «заявка → инженер»."""
    request_by_id = problem.request_by_id
    assignments: list[AssignmentOut] = []
    for entry in report.get("routes", []):
        engineer_id = entry["engineer_id"]
        engineer = problem.engineer_by_id[engineer_id]
        for sequence, row in enumerate(entry.get("schedule", []), start=1):
            request = request_by_id[row["task_id"]]
            assignments.append(
                AssignmentOut(
                    request_id=request["id"],
                    engineer_id=engineer_id,
                    engineer_name=engineer.get("name", engineer_id),
                    sequence=sequence,
                    window_start=request["window_start"],
                    window_end=request["window_end"],
                    arrival=row["arrival"],
                    start=row["start"],
                    required_skill=request["required_skill"],
                )
            )
    return assignments


def build_map_geojson(problem: AdaptedProblem, report: dict[str, Any]) -> dict[str, Any]:
    """Собирает GeoJSON: линии маршрутов и точки заявок."""
    request_by_id = problem.request_by_id
    features: list[dict[str, Any]] = []

    assigned: dict[str, tuple[str, int]] = {}
    for route_index, entry in enumerate(report.get("routes", [])):
        engineer_id = entry["engineer_id"]
        engineer = problem.engineer_by_id[engineer_id]
        color = ROUTE_COLORS[route_index % len(ROUTE_COLORS)]
        coordinates = [[engineer["longitude"], engineer["latitude"]]]
        for sequence, row in enumerate(entry.get("schedule", []), start=1):
            request = request_by_id[row["task_id"]]
            coordinates.append([request["longitude"], request["latitude"]])
            assigned[request["id"]] = (engineer_id, sequence)
        if len(coordinates) > 1:
            features.append(
                {
                    "type": "Feature",
                    "geometry": {"type": "LineString", "coordinates": coordinates},
                    "properties": {
                        "feature_type": "route",
                        "engineer_id": engineer_id,
                        "engineer_name": engineer.get("name", engineer_id),
                        "transport": engineer["transport"],
                        "distance_km": round(float(entry.get("distance_km", 0.0)), 3),
                        "task_count": len(coordinates) - 1,
                        "color": color,
                        "geometry_source": "straight_line",
                    },
                }
            )

    # Точки заявок: назначенные и неназначенные.
    for request in problem.requests:
        info = assigned.get(request["id"])
        features.append(
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [request["longitude"], request["latitude"]],
                },
                "properties": {
                    "feature_type": "request",
                    "request_id": request["id"],
                    "address": request.get("address"),
                    "status": "assigned" if info else "unassigned",
                    "engineer_id": info[0] if info else None,
                    "sequence": info[1] if info else None,
                    "required_skill": request["required_skill"],
                    "window_start": request["window_start"],
                    "window_end": request["window_end"],
                    "priority": request["priority"],
                },
            }
        )

    # Стартовые точки инженеров.
    for engineer in problem.engineers:
        features.append(
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [engineer["longitude"], engineer["latitude"]],
                },
                "properties": {
                    "feature_type": "engineer_start",
                    "engineer_id": engineer["id"],
                    "engineer_name": engineer.get("name", engineer["id"]),
                    "transport": engineer["transport"],
                    "shift_start": engineer["shift_start"],
                    "shift_end": engineer["shift_end"],
                },
            }
        )

    sources = problem.matrix_sources or {}
    uses_ors = any(source.startswith("openrouteservice") for source in sources.values())
    if uses_ors:
        assumption = (
            "Расстояния и время в пути рассчитаны по дорожной сети "
            "OpenStreetMap через OpenRouteService. Для общественного транспорта "
            "настоящего профиля нет: линия строится по автомобильным дорогам, "
            "а время пересчитывается эвристикой 18/35 км/ч с ожиданием."
        )
    else:
        assumption = (
            "Маршруты построены по прямым между точками с дорожным коэффициентом "
            f"{problem.road_factor}; это упрощение MVP, а не данные дорожного графа."
        )

    return {
        "type": "FeatureCollection",
        "features": features,
        "metadata": {
            "road_factor": problem.road_factor,
            "data_source": "openrouteservice" if uses_ors else "straight_line_estimate",
            "matrix_sources": sources,
            "geometry_source": "straight_line",
            "assumption": assumption,
        },
    }


def _route_waypoints(route: RouteOut) -> list[tuple[float, float]]:
    """Возвращает упорядоченные точки маршрута (старт инженера + заявки)."""
    waypoints: list[tuple[float, float]] = []
    if route.start_latitude is not None and route.start_longitude is not None:
        waypoints.append((route.start_latitude, route.start_longitude))
    waypoints.extend((point.latitude, point.longitude) for point in route.route)
    return waypoints


def _straight_line_geometry(waypoints: list[tuple[float, float]]) -> list[list[float]]:
    """Превращает точки ``(широта, долгота)`` в координаты GeoJSON ``[lon, lat]``."""
    return [[longitude, latitude] for latitude, longitude in waypoints]


def _geometry_source(transport: str | None, profile: str, provider: str = "openrouteservice") -> str:
    """Метка источника геометрии с учётом фактического провайдера."""
    if provider == "straight_line":
        return "straight_line"
    if provider == "local_osrm":
        base = "local_osrm:car"
    elif provider == "osrm":
        base = f"osrm:{profile}"
    elif provider == "mixed":
        base = f"mixed:{profile}"
    else:
        base = f"openrouteservice:{profile}"
    if transport and transport != "car":
        base += f"+{transport}"
    return base


def attach_route_geometry(
    routes: list[RouteOut],
    ors_client: OpenRouteServiceClient | None,
) -> list[RouteOut]:
    """Дополняет маршруты дорожной геометрией для карты.

    Если ORS доступен и у транспорта есть профиль, подставляется дорожный
    полилайн. Иначе (или при сбое) используется линия по точкам маршрута, а
    ``geometry_source`` явно помечается как ``straight_line``.
    """
    for route in routes:
        waypoints = _route_waypoints(route)
        if len(waypoints) < 2:
            # Нет маршрута (инженер без заявок) — геометрия не нужна.
            route.geometry = None
            route.geometry_source = None
            continue

        profile = ors_client.geometry_profile_for(route.transport) if ors_client else None
        if profile:
            try:
                road = ors_client.route_geometry(waypoints, profile, transport=route.transport)
            except OrsError as exc:
                logger.warning("ORS: не удалось построить геометрию %s: %s", route.engineer_id, exc)
            else:
                route.geometry = road.coordinates
                route.geometry_source = _geometry_source(
                    route.transport, profile, road.provider
                )
                continue

        route.geometry = _straight_line_geometry(waypoints)
        route.geometry_source = "straight_line"
    return routes


def enrich_geojson_geometry(
    geojson: dict[str, Any],
    ors_client: OpenRouteServiceClient | None,
    mode: str = "road",
) -> dict[str, Any]:
    """Заменяет линии GeoJSON на дорожную геометрию ORS.

    ``mode='straight'`` принудительно оставляет прямые отрезки (полезно для
    отладки и тестов). При сбое ORS конкретный маршрут остаётся прямой линией,
    а причина попадает в ``metadata.geometry_warnings``.
    """
    features = geojson.get("features", [])
    warnings: list[str] = []
    used_providers: set[str] = set()

    for feature in features:
        geometry = feature.get("geometry") or {}
        if geometry.get("type") != "LineString":
            continue
        properties = feature.setdefault("properties", {})
        coordinates = geometry.get("coordinates") or []
        waypoints = [(latitude, longitude) for longitude, latitude in coordinates]
        profile = (
            ors_client.geometry_profile_for(properties.get("transport"))
            if (ors_client and mode == "road")
            else None
        )
        if profile and len(waypoints) >= 2:
            try:
                road = ors_client.route_geometry(
                    waypoints, profile, transport=properties.get("transport")
                )
            except OrsError as exc:
                warnings.append(
                    f"Маршрут {properties.get('engineer_id')}: маршрутизатор недоступен "
                    f"({exc}); показана прямая линия"
                )
            else:
                geometry["coordinates"] = road.coordinates
                properties["geometry_source"] = _geometry_source(
                    properties.get("transport"), profile, road.provider
                )
                used_providers.add(road.provider)
                continue
        properties["geometry_source"] = "straight_line"

    metadata = geojson.setdefault("metadata", {})
    if used_providers == {"local_osrm"}:
        metadata["geometry_source"] = "local_osrm"
    elif used_providers == {"openrouteservice"}:
        metadata["geometry_source"] = "openrouteservice"
    elif used_providers == {"osrm"}:
        metadata["geometry_source"] = "osrm"
    elif used_providers:
        metadata["geometry_source"] = "mixed"
    else:
        metadata["geometry_source"] = "straight_line"
    if warnings:
        metadata["geometry_warnings"] = warnings
    return geojson

"""Преобразование сохранённого плана в ответы API."""
from __future__ import annotations

from typing import Any

from app.schemas.plan import PlanListItem, PlanResponse, PlanSummary, RouteOut
from app.services.ors_client import OpenRouteServiceClient
from app.services.route_service import attach_route_geometry, enrich_geojson_geometry
from app.storage.models import Plan


def _summary_from_result(result: dict[str, Any]) -> PlanSummary:
    """Извлекает сводку из сохранённого результата."""
    summary = result.get("summary", {})
    return PlanSummary(**summary)


def plan_to_response(
    plan: Plan, ors_client: OpenRouteServiceClient | None = None
) -> PlanResponse:
    """Собирает полный ответ по сохранённому плану.

    Дорожная геометрия маршрутов строится на чтении (в БД хранятся только
    точки), чтобы ответ всегда был актуальным и не раздувал хранилище.
    """
    result = plan.result or {}
    meta = plan.algorithm_meta or {}
    summary = _summary_from_result(result)
    routes = [RouteOut(**item) for item in result.get("routes", [])]
    # Планы, сохранённые до появления стартовых координат в RouteOut, дополняем
    # из снимка входных данных, чтобы геометрия строилась от старта инженера.
    engineers = {
        engineer["id"]: engineer
        for engineer in (plan.input_payload or {}).get("engineers", [])
    }
    for route in routes:
        if route.start_latitude is None or route.start_longitude is None:
            engineer = engineers.get(route.engineer_id)
            if engineer:
                route.start_latitude = engineer.get("latitude")
                route.start_longitude = engineer.get("longitude")
    attach_route_geometry(routes, ors_client)
    # Встроенный снимок карты обогащаем той же дорожной геометрией, что и
    # /visualization/{id}/geojson (кэш ORS делает это бесплатным после routes).
    map_geojson = result.get("map_geojson")
    if map_geojson:
        map_geojson = enrich_geojson_geometry(map_geojson, ors_client, mode="road")
    return PlanResponse(
        plan_id=plan.id,
        scenario_id=plan.scenario_id,
        parent_plan_id=plan.parent_plan_id,
        kind=plan.kind,
        status=plan.status,
        version=int(meta.get("version", 0) or 0),
        strategy=meta.get("strategy", "ours"),
        event_id=meta.get("event_id"),
        created_at=plan.created_at,
        summary=summary,
        metrics=plan.metrics,
        routes=routes,
        assignments=result.get("assignments", []),
        unassigned=result.get("unassigned", []),
        explanations=result.get("explanations", []),
        changes=result.get("changes", []),
        violations=result.get("violations", []),
        map_geojson=map_geojson,
        algorithm_metadata={
            "solver": meta.get("solver"),
            "seed": meta.get("seed"),
            "elapsed_seconds": meta.get("elapsed_seconds"),
            "road_factor": meta.get("road_factor"),
            "matrix_sources": meta.get("matrix_sources", {}),
            "warnings": meta.get("warnings", []),
            "solver_metadata": meta.get("solver_metadata", {}),
        },
    )


def plan_to_list_item(plan: Plan) -> PlanListItem:
    """Собирает краткую карточку плана для списка."""
    result = plan.result or {}
    meta = plan.algorithm_meta or {}
    summary = result.get("summary", {})
    return PlanListItem(
        plan_id=plan.id,
        scenario_id=plan.scenario_id,
        kind=plan.kind,
        status=plan.status,
        version=int(meta.get("version", 0) or 0),
        event_id=meta.get("event_id"),
        event_type=meta.get("event_type"),
        headline=meta.get("headline"),
        created_at=plan.created_at,
        engineers_used=int(summary.get("engineers_used", 0)),
        total_distance_km=float(summary.get("total_distance_km", 0.0)),
        planned_count=int(summary.get("planned_count", 0)),
    )

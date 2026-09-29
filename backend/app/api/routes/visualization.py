"""Маршруты визуализации плана: GeoJSON и демонстрационная карта Leaflet."""
from __future__ import annotations

from typing import Literal

from fastapi import Security, APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import HTMLResponse

from app.api.deps import verify_token, get_ors_client, get_repository
from app.api.responses import error_responses
from app.services.ors_client import OpenRouteServiceClient
from app.services.route_service import enrich_geojson_geometry
from app.storage.repository import Repository

router = APIRouter(prefix="/visualization", tags=["Визуализация"], dependencies=[Security(verify_token)])

_MAP_TEMPLATE = """<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Маршруты плана {plan_id}</title>
    <link
        rel="stylesheet"
        href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
        integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
        crossorigin=""
    />
    <style>
        html, body {{ height: 100%; margin: 0; }}
        #map {{ height: 100%; width: 100%; }}
        .legend {{
            background: white; padding: 8px 12px; border-radius: 6px;
            font: 13px/1.4 sans-serif; box-shadow: 0 0 8px rgba(0,0,0,.3);
        }}
        .legend span {{ display: inline-block; width: 12px; height: 12px; margin-right: 6px; }}
    </style>
</head>
<body>
<div id="map"></div>
<script
    src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
    integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo="
    crossorigin=""
></script>
<script>
    const map = L.map('map').setView([55.751244, 37.618423], 11);
    L.tileLayer('https://{{s}}.tile.openstreetmap.org/{{z}}/{{x}}/{{y}}.png', {{
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap'
    }}).addTo(map);

    fetch('geojson?geometry={geometry}')
        .then(response => response.json())
        .then(data => {{
            const bounds = [];
            const layers = [];
            data.features.forEach(feature => {{
                const props = feature.properties || {{}};
                if (feature.geometry.type === 'LineString') {{
                    const coords = feature.geometry.coordinates.map(c => [c[1], c[0]]);
                    const line = L.polyline(coords, {{
                        color: props.color || '#1f77b4', weight: 4
                    }}).addTo(map);
                    line.bindPopup(
                        '<b>' + props.engineer_name + '</b><br/>' +
                        'Заявок: ' + props.task_count + '<br/>' +
                        'Пробег: ' + props.distance_km + ' км<br/>' +
                        'Геометрия: ' + (props.geometry_source || '—')
                    );
                    layers.push(line);
                    coords.forEach(c => bounds.push(c));
                }}
            }});
            data.features.forEach(feature => {{
                if (feature.geometry.type !== 'Point') return;
                const props = feature.properties || {{}};
                const coord = [feature.geometry.coordinates[1], feature.geometry.coordinates[0]];
                let color = '#888', radius = 6, label = '';
                if (props.feature_type === 'engineer_start') {{
                    color = '#000'; radius = 7; label = 'Старт: ' + props.engineer_name;
                }} else if (props.feature_type === 'request') {{
                    color = props.status === 'assigned' ? '#2ca02c' : '#d62728';
                    radius = props.status === 'assigned' ? 6 : 8;
                    label = 'Заявка ' + props.request_id + ' — ' +
                        (props.status === 'assigned' ? ('инженер ' + props.engineer_id) : 'не назначена') +
                        '<br/>Окно: ' + props.window_start + '–' + props.window_end;
                }}
                L.circleMarker(coord, {{
                    radius: radius, color: color, fillColor: color, fillOpacity: 0.8
                }}).bindPopup(label).addTo(map);
                bounds.push(coord);
            }});
            if (bounds.length) map.fitBounds(bounds, {{ padding: [20, 20] }});
        }});
</script>
</body>
</html>
"""


@router.get(
    "/{plan_id}/geojson",
    summary="GeoJSON маршрутов и точек",
    response_description=(
        "FeatureCollection: линии маршрутов (дорожная геометрия), точки заявок "
        "(назначенные/неназначенные) и старты инженеров."
    ),
    responses=error_responses("not_found"),
    description=(
        "Возвращает FeatureCollection для Leaflet/OpenStreetMap: линии маршрутов, "
        "точки заявок и старты инженеров. По умолчанию линии строятся по дорожной "
        "сети через OpenRouteService; при параметре `geometry=straight` остаются "
        "прямыми. Источник геометрии указан в `properties.geometry_source` каждой "
        "линии и в `metadata.geometry_source`."
    ),
)
def get_plan_geojson(
    plan_id: str,
    geometry: Literal["road", "straight", "cached"] = Query(
        "road",
        description=(
            "`road` — дорожная геометрия через OpenRouteService; `cached` — использовать "
            "кэш (без живых вызовов); `straight` — прямые отрезки."
        ),
    ),
    engineer_id: str | None = Query(None, description="Показать только маршрут этого инженера"),
    repository: Repository = Depends(get_repository),
    ors_client: OpenRouteServiceClient | None = Depends(get_ors_client),
) -> dict:
    """Возвращает GeoJSON сохранённого плана с дорожной геометрией маршрутов."""
    plan = repository.get_plan(plan_id)
    if plan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="План не найден")
    geojson = (plan.result or {}).get("map_geojson")
    if not geojson:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Для плана нет данных визуализации"
        )
    mode = "straight" if geometry == "straight" else "road"
    # cached использует тот же путь, но клиент ORS отдаёт геометрию из своего кэша
    # (живой запрос выполняется только при первом обращении).
    result = enrich_geojson_geometry(geojson, ors_client, mode=mode)
    if engineer_id:
        result = _filter_by_engineer(result, engineer_id)
    return result


def _filter_by_engineer(geojson: dict, engineer_id: str) -> dict:
    """Оставляет фичи выбранного инженера (для экрана инженера)."""
    filtered = []
    for feature in geojson.get("features", []):
        properties = feature.get("properties", {})
        if properties.get("feature_type") == "engineer_start":
            if properties.get("engineer_id") == engineer_id:
                filtered.append(feature)
        elif properties.get("feature_type") == "route":
            if properties.get("engineer_id") == engineer_id:
                filtered.append(feature)
        elif properties.get("feature_type") == "request":
            if properties.get("engineer_id") == engineer_id:
                filtered.append(feature)
    return {**geojson, "features": filtered}


@router.get(
    "/{plan_id}/map",
    response_class=HTMLResponse,
    summary="Демонстрационная карта Leaflet",
    response_description="HTML-страница с картой OpenStreetMap и маршрутами плана.",
    responses=error_responses("not_found"),
    description=(
        "HTML-страница с картой OpenStreetMap и маршрутами плана (Leaflet "
        "подключается с CDN). Маршруты отображаются по дорожной сети."
    ),
)
def get_plan_map(
    plan_id: str,
    geometry: Literal["road", "straight", "cached"] = Query(
        "road", description="`road`/`cached` — дорожная геометрия; `straight` — прямые отрезки."
    ),
    repository: Repository = Depends(get_repository),
) -> HTMLResponse:
    """Отдаёт готовую HTML-карту для быстрой демонстрации."""
    plan = repository.get_plan(plan_id)
    if plan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="План не найден")
    return HTMLResponse(content=_MAP_TEMPLATE.format(plan_id=plan_id, geometry=geometry))

"""Геопространственные утилиты адаптера.

Алгоритм оптимизации работает с матрицами расстояний (в метрах) и времени
(в минутах) между узлами.

Провайдеры (Enterprise-архитектура):
* **car** — один запрос матрицы к локальному OSRM (`/table`, MLD);
* **walk / bike / public_transport** — считаем прямо в Python:
  расстояние = гаверсинус × 1.3, время — по скоростям из ТЗ
  (walk 4.5 км/ч, bike 14 км/ч, ОТ — эвристика 18/35 км/ч с ожиданием).

Если локальный OSRM недоступен для автомобиля — глубокий фолбэк: облачный
OpenRouteService, затем оценка по прямой.
"""
from __future__ import annotations

import hashlib
import logging
import math
from dataclasses import dataclass, field

from app.core.constants import (
    MATH_ROAD_FACTOR,
    MATH_SPEED_KMH,
    TRANSPORT_BIKE,
    TRANSPORT_CAR,
    TRANSPORT_PUBLIC,
    TRANSPORT_SPEED_KMH,
    TRANSPORT_WALK,
    math_travel_minutes,
    public_transport_minutes,
)
from app.services.local_osrm import LocalOsrmClient, OsrmError
from app.services.ors_client import OpenRouteServiceClient, OrsError

logger = logging.getLogger(__name__)

EARTH_RADIUS_KM = 6371.0088

# Границы демонстрационного геокодирования (Москва и ближнее Подмосковье).
_DEMO_GEO_BBOX = (55.55, 55.95, 37.35, 37.95)

#: Метка источника матрицы для резервного расчёта.
_FALLBACK_SOURCE = "straight_line_estimate"

#: Транспорт, для которого матрица считается математикой (без OSRM).
MATH_TRANSPORTS = {TRANSPORT_WALK, TRANSPORT_BIKE, TRANSPORT_PUBLIC}


@dataclass
class MatrixBundle:
    """Матрицы расстояний и времени по каждому типу транспорта."""

    distance_m: dict[str, list[list[int]]]
    travel_minutes: dict[str, list[list[int]]]
    sources: dict[str, str] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Возвращает расстояние между двумя точками по большому кругу, км."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(a))


def demo_geocode(address: str) -> tuple[float, float]:
    """Детерминированное демонстрационное геокодирование адреса.

    ВНИМАНИЕ: это не обращение к реальному геокодеру. Одинаковый адрес всегда
    даёт одну и ту же точку внутри ограничивающего прямоугольника Москвы. Метод
    нужен только для демонстрации, когда в заявке указан адрес без координат.
    """
    digest = hashlib.sha256(address.strip().lower().encode("utf-8")).digest()
    lat_span = _DEMO_GEO_BBOX[1] - _DEMO_GEO_BBOX[0]
    lon_span = _DEMO_GEO_BBOX[3] - _DEMO_GEO_BBOX[2]
    lat = _DEMO_GEO_BBOX[0] + (int.from_bytes(digest[:8], "big") / 2**64) * lat_span
    lon = _DEMO_GEO_BBOX[2] + (int.from_bytes(digest[8:16], "big") / 2**64) * lon_span
    return round(lat, 6), round(lon, 6)


def build_distance_matrix(coordinates: list[tuple[float, float]], road_factor: float) -> list[list[int]]:
    """Резервная матрица расстояний (в метрах) по прямой с дорожным коэффициентом."""
    size = len(coordinates)
    matrix = [[0] * size for _ in range(size)]
    for i in range(size):
        lat_i, lon_i = coordinates[i]
        for j in range(i + 1, size):
            lat_j, lon_j = coordinates[j]
            metres = int(round(haversine_km(lat_i, lon_i, lat_j, lon_j) * road_factor * 1000))
            matrix[i][j] = metres
            matrix[j][i] = metres
    return matrix


def build_travel_matrix(distance_m: list[list[int]], transport: str) -> list[list[int]]:
    """Резервная матрица времени в пути (в минутах) для типа транспорта."""
    size = len(distance_m)
    matrix = [[0] * size for _ in range(size)]
    for i in range(size):
        for j in range(size):
            metres = distance_m[i][j]
            if metres <= 0:
                continue
            km = metres / 1000.0
            if transport == TRANSPORT_PUBLIC:
                matrix[i][j] = public_transport_minutes(km)
            else:
                speed = MATH_SPEED_KMH.get(
                    transport, TRANSPORT_SPEED_KMH.get(transport, TRANSPORT_SPEED_KMH[TRANSPORT_CAR])
                )
                matrix[i][j] = int(math.ceil(km / speed * 60))
    return matrix


def build_math_distance_matrix(
    coordinates: list[tuple[float, float]], factor: float = MATH_ROAD_FACTOR
) -> list[list[int]]:
    """Матрица расстояний для не-авто транспорта: гаверсинус × factor."""
    return build_distance_matrix(coordinates, factor)


def _merge_with_fallback(matrix: list[list[int]], fallback: list[list[int]]) -> list[list[int]]:
    """Подставляет резервные значения вместо нулевых (недостижимых) пар ORS."""
    size = len(matrix)
    return [
        [
            matrix[i][j] if matrix[i][j] else fallback[i][j]
            for j in range(size)
        ]
        for i in range(size)
    ]


def build_matrices(
    coordinates: list[tuple[float, float]],
    transports: set[str],
    road_factor: float,
    ors_client: OpenRouteServiceClient | None = None,
    local_osrm: LocalOsrmClient | None = None,
) -> MatrixBundle:
    """Строит матрицы расстояний и времени для всех используемых транспортов.

    * ``car`` — локальный OSRM (`/table`); при сбое — облачный ORS, затем прямая.
    * ``walk`` / ``bike`` / ``public_transport`` — математика (гаверсинус × 1.3
      и скорости из ТЗ), без обращения к OSRM.
    """
    math_distance = build_math_distance_matrix(coordinates)
    fallback_distance = build_distance_matrix(coordinates, road_factor)
    fallback_travel = {
        transport: build_travel_matrix(fallback_distance, transport) for transport in transports
    }

    distance_matrices: dict[str, list[list[int]]] = {}
    travel_matrices: dict[str, list[list[int]]] = {}
    sources: dict[str, str] = {}
    warnings: list[str] = []

    for transport in sorted(transports):
        # 1) Автомобиль — локальный OSRM.
        if transport == TRANSPORT_CAR and local_osrm is not None:
            try:
                table = local_osrm.table(coordinates)
            except OsrmError as exc:
                logger.warning("Локальный OSRM недоступен для car: %s", exc)
                warnings.append(
                    f"Транспорт «car»: локальный OSRM недоступен ({exc}); "
                    f"пробуем облачный провайдер"
                )
            else:
                distance_matrices[transport] = table.distance_m
                travel_matrices[transport] = table.duration_min
                sources[transport] = "local_osrm:car"
                continue

        # 2) Остальные виды транспорта — математика (OSRM не трогаем).
        if transport in MATH_TRANSPORTS:
            distance_matrices[transport] = [row[:] for row in math_distance]
            travel_matrices[transport] = build_travel_matrix(math_distance, transport)
            sources[transport] = f"math:{transport}"
            continue

        # 3) Глубокий фолбэк для car — облачный OpenRouteService.
        # без ключа ORS матриц не просим: клиент может жить только ради геометрии (FOSSGIS)
        profile = ors_client.profile_for(transport) if ors_client and ors_client.ors_enabled else None
        if profile:
            try:
                matrix = ors_client.matrix(coordinates, profile)
            except OrsError as exc:
                logger.warning("ORS недоступен для %s: %s", transport, exc)
                warnings.append(
                    f"Транспорт «{transport}»: OpenRouteService недоступен ({exc}); "
                    f"использована оценка по прямой с коэффициентом {road_factor}"
                )
            else:
                distance_matrices[transport] = _merge_with_fallback(
                    matrix.distance_m, fallback_distance
                )
                travel_matrices[transport] = _merge_with_fallback(
                    matrix.duration_min, fallback_travel[transport]
                )
                sources[transport] = f"openrouteservice:{profile}"
                continue

        # 4) Крайний фолбэк — прямая с дорожным коэффициентом.
        distance_matrices[transport] = [row[:] for row in fallback_distance]
        travel_matrices[transport] = fallback_travel[transport]
        sources[transport] = _FALLBACK_SOURCE

    return MatrixBundle(
        distance_m=distance_matrices,
        travel_minutes=travel_matrices,
        sources=sources,
        warnings=warnings,
    )

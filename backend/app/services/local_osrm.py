"""Клиент локального OSRM (автомобильный профиль) — основной провайдер.

Локальный OSRM поднимается в Docker из `osrm/docker-compose.osrm.yml` на
графе `car.lua` (алгоритм MLD) и умеет считать матрицы (`/table`) и геометрию
(`/route`). К нему обращаемся для автомобиля (матрицы + геометрия) и для
геометрии остальных видов транспорта (визуальный «хак»: линия по улицам,
а время/дистанция считаются математикой в приложении).
"""
from __future__ import annotations

import json
import logging
import math
import urllib.error
import urllib.parse
import urllib.request
from collections import OrderedDict
from dataclasses import dataclass

logger = logging.getLogger(__name__)


class OsrmError(RuntimeError):
    """Ошибка обращения к локальному OSRM."""


@dataclass
class OsrmTable:
    """Матрицы локального OSRM: расстояния (м) и время (мин)."""

    distance_m: list[list[int]]
    duration_min: list[list[int]]


class LocalOsrmClient:
    """Клиент локального OSRM с кэшем и блочными запросами."""

    def __init__(
        self,
        base_url: str = "http://osrm:5000",
        timeout_seconds: float = 15.0,
        cache_size: int = 6,
        table_chunk_size: int = 50,
        route_chunk_size: int = 49,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds
        self.cache_size = max(0, cache_size)
        self.table_chunk_size = max(1, table_chunk_size)
        self.route_chunk_size = max(2, route_chunk_size)
        self._table_cache: OrderedDict[tuple, OsrmTable] = OrderedDict()
        self._route_cache: OrderedDict[tuple, tuple] = OrderedDict()

    # --- Служебное ---------------------------------------------------------
    def available(self) -> bool:
        """Проверяет, что локальный OSRM отвечает."""
        try:
            self._get("/nearest/v1/driving/37.62,55.75", {"number": 1})
            return True
        except OsrmError:
            return False

    def _get(self, path: str, params: dict) -> dict:
        url = f"{self.base_url}{path}?{urllib.parse.urlencode(params)}"
        request = urllib.request.Request(url, headers={"User-Agent": "beeline-rps/1.0"})
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                data = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:200]
            raise OsrmError(f"OSRM HTTP {exc.code}: {detail}") from exc
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise OsrmError(f"OSRM недоступен: {exc}") from exc
        if data.get("code") not in (None, "Ok"):
            raise OsrmError(f"OSRM ошибка: {data.get('code')} {data.get('message', '')}")
        return data

    def _cache_put(self, cache: OrderedDict, key, value) -> None:
        if not self.cache_size:
            return
        cache[key] = value
        cache.move_to_end(key)
        while len(cache) > self.cache_size:
            cache.popitem(last=False)

    @staticmethod
    def _coord(value: tuple[float, float]) -> str:
        lat, lon = value
        return f"{lon},{lat}"

    # --- Матрица (car) -----------------------------------------------------
    def table(self, coordinates: list[tuple[float, float]]) -> OsrmTable:
        """Матрицы расстояний/времени для всех пар точек (автомобиль)."""
        key = tuple((round(lat, 5), round(lon, 5)) for lat, lon in coordinates)
        cached = self._table_cache.get(key)
        if cached is not None:
            self._table_cache.move_to_end(key)
            return cached

        size = len(coordinates)
        distances = [[0] * size for _ in range(size)]
        durations = [[0] * size for _ in range(size)]
        chunk = self.table_chunk_size
        for source_start in range(0, size, chunk):
            source_idx = list(range(source_start, min(source_start + chunk, size)))
            for dest_start in range(0, size, chunk):
                dest_idx = list(range(dest_start, min(dest_start + chunk, size)))
                locations = [coordinates[i] for i in source_idx + dest_idx]
                path = "/table/v1/driving/" + ";".join(self._coord(c) for c in locations)
                # Явно указываем источники/назначения: locations = источники + назначения,
                # поэтому матрица получится (|sources| × |destinations|).
                data = self._get(
                    path,
                    {
                        "annotations": "duration,distance",
                        "sources": ";".join(str(i) for i in range(len(source_idx))),
                        "destinations": ";".join(
                            str(len(source_idx) + j) for j in range(len(dest_idx))
                        ),
                    },
                )
                raw_durations = data.get("durations") or []
                raw_distances = data.get("distances") or []
                for row, si in enumerate(source_idx):
                    for col, dj in enumerate(dest_idx):
                        if si == dj:
                            continue
                        if row < len(raw_distances) and col < len(raw_distances[row]):
                            value = raw_distances[row][col]
                            if value is not None:
                                distances[si][dj] = int(round(float(value)))
                        if row < len(raw_durations) and col < len(raw_durations[row]):
                            value = raw_durations[row][col]
                            if value is not None:
                                durations[si][dj] = int(math.ceil(float(value) / 60.0))
        result = OsrmTable(distance_m=distances, duration_min=durations)
        self._cache_put(self._table_cache, key, result)
        return result

    # --- Геометрия (car) ---------------------------------------------------
    def route(
        self, waypoints: list[tuple[float, float]]
    ) -> tuple[list[list[float]], float, float]:
        """Геометрия автомобильного маршрута: (координаты [lon,lat], метры, секунды)."""
        if len(waypoints) < 2:
            raise OsrmError("Для маршрута нужно минимум две точки")
        key = tuple((round(lat, 5), round(lon, 5)) for lat, lon in waypoints)
        cached = self._route_cache.get(key)
        if cached is not None:
            self._route_cache.move_to_end(key)
            return cached

        coordinates: list[list[float]] = []
        total_distance = 0.0
        total_duration = 0.0
        step = self.route_chunk_size
        for start in range(0, len(waypoints), step):
            chunk = waypoints[start : start + step + 1]
            if len(chunk) < 2:
                break
            path = "/route/v1/driving/" + ";".join(self._coord(c) for c in chunk)
            data = self._get(
                path,
                {
                    "overview": "full",
                    "geometries": "geojson",
                    "steps": "false",
                    "continue_straight": "false",
                },
            )
            routes = data.get("routes") or []
            if not routes:
                raise OsrmError("OSRM не вернул маршрут")
            route = routes[0]
            segment = (route.get("geometry") or {}).get("coordinates") or []
            if not segment:
                raise OsrmError("OSRM не вернул геометрию")
            if coordinates:
                segment = segment[1:]
            coordinates.extend(segment)
            total_distance += float(route.get("distance") or 0.0)
            total_duration += float(route.get("duration") or 0.0)
        result = (coordinates, total_distance, total_duration)
        self._cache_put(self._route_cache, key, result)
        return result

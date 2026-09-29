"""Клиент OpenRouteService для расчёта дорожных расстояний и времени в пути.

Публичное Matrix API ORS принимает координаты и возвращает матрицы расстояний
(метры) и длительности (секунды). Для одного запроса публичная версия допускает
не более 3 500 пар «источник × назначение» (например, 50 × 50), поэтому большие
матрицы считаются блоками и собираются в одну.

Тип транспорта кейса отображается на профиль ORS:

* ``car`` → ``driving-car``
* ``bike`` → ``cycling-regular``
* ``walk`` → ``foot-walking``
* ``public_transport`` — публичное API ORS не поддерживает, используется
  резервная оценка адаптера.
"""
from __future__ import annotations

import json
import logging
import math
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import OrderedDict
from dataclasses import dataclass

from app.core.constants import MATH_ROAD_FACTOR, math_travel_minutes, public_transport_minutes

logger = logging.getLogger(__name__)


def _path_km(waypoints: list[tuple[float, float]]) -> float:
    """Суммарная длина ломаной по точкам (гаверсинус), км."""
    total = 0.0
    for (lat1, lon1), (lat2, lon2) in zip(waypoints, waypoints[1:]):
        phi1, phi2 = math.radians(lat1), math.radians(lat2)
        dphi = math.radians(lat2 - lat1)
        dlambda = math.radians(lon2 - lon1)
        a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
        total += 2 * 6371.0088 * math.asin(math.sqrt(a))
    return total

#: Соответствие типов транспорта кейса профилям OpenRouteService (матрицы/time).
TRANSPORT_TO_ORS_PROFILE: dict[str, str] = {
    "car": "driving-car",
    "bike": "cycling-regular",
    "walk": "foot-walking",
}

#: Профиль для построения ГЕОМЕТРИИ. У общественного транспорта настоящего
#: профиля в публичном ORS нет, поэтому для красивой линии по дорогам берём
#: автомобильную геометрию, а время пересчитываем эвристикой (см. route_geometry).
TRANSPORT_TO_GEOMETRY_PROFILE: dict[str, str] = {
    "car": "driving-car",
    "bike": "cycling-regular",
    "walk": "foot-walking",
    "public_transport": "driving-car",
}

#: Запасной бесплатный роутер FOSSGIS OSRM (когда квота ORS исчерпана).
OSRM_BASE_URL = "https://routing.openstreetmap.de"
#: ORS-профиль → профиль OSRM (routed-<p>).
OSRM_PROFILE_BY_ORS: dict[str, str] = {
    "driving-car": "car",
    "cycling-regular": "bike",
    "foot-walking": "foot",
}

#: Повторяемые HTTP-статусы ORS (лимиты и временные сбои).
_RETRYABLE_STATUS = {429, 500, 502, 503, 504}

#: Максимум waypoint на запрос Directions API (публичное API ORS).
DIRECTIONS_MAX_WAYPOINTS = 50


class OrsError(RuntimeError):
    """Ошибка обращения к OpenRouteService."""


@dataclass
class OrsMatrix:
    """Готовая матрица ORS: расстояния в метрах, время в минутах."""

    profile: str
    distance_m: list[list[int]]
    duration_min: list[list[int]]
    sources_count: int
    destinations_count: int


@dataclass
class OrsRoute:
    """Дорожная геометрия маршрута, построенная Directions API."""

    profile: str
    coordinates: list[list[float]]
    distance_m: int
    duration_s: int
    provider: str = "openrouteservice"


class OpenRouteServiceClient:
    """Клиент Matrix API с блочным расчётом и LRU-кэшем.

    Экземпляр создаётся один раз на процесс и переиспользуется между запросами,
    поэтому повторные расчёты по тем же координатам не тратят квоту ORS.
    """

    def __init__(
        self,
        api_key: str,
        base_url: str = "https://api.openrouteservice.org",
        timeout_seconds: float = 30.0,
        chunk_size: int = 50,
        cache_size: int = 8,
        max_retries: int = 2,
        rate_limit_cooldown_seconds: float = 60.0,
        quota_cooldown_seconds: float = 300.0,
        osrm_base_url: str = OSRM_BASE_URL,
        osrm_enabled: bool = True,
        local_osrm=None,
    ) -> None:
        self.api_key = api_key or ""
        # ORS может отсутствовать — тогда работаем только на локальном/облачном OSRM.
        self.ors_enabled = bool(api_key)
        self.local_osrm = local_osrm
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds
        self.chunk_size = max(1, chunk_size)
        self.cache_size = max(0, cache_size)
        self.max_retries = max(0, max_retries)
        # При 429 включаем «предохранитель»: не долбим ORS, сразу откат на прямые.
        self.rate_limit_cooldown_seconds = max(0.0, rate_limit_cooldown_seconds)
        # При исчерпании дневной квоты (403) — короткий cooldown и повтор позже.
        self.quota_cooldown_seconds = max(0.0, quota_cooldown_seconds)
        self._rate_limited_until = 0.0
        self.osrm_base_url = osrm_base_url.rstrip("/")
        self.osrm_enabled = osrm_enabled
        self._cache: OrderedDict[tuple, OrsMatrix] = OrderedDict()
        self._route_cache: OrderedDict[tuple, OrsRoute] = OrderedDict()

    def _ensure_not_rate_limited(self) -> None:
        """Бросает ошибку, если активен cooldown после 429 (без обращения к сети)."""
        if time.monotonic() < self._rate_limited_until:
            remaining = int(self._rate_limited_until - time.monotonic())
            raise OrsError(f"ORS: превышен лимит запросов, cooldown ещё {remaining} с")

    # --- Публичный интерфейс ----------------------------------------------
    def profile_for(self, transport: str) -> str | None:
        """Профиль ORS для матриц (``None`` — транспорт без профиля)."""
        return TRANSPORT_TO_ORS_PROFILE.get(transport)

    def geometry_profile_for(self, transport: str) -> str | None:
        """Профиль ORS для геометрии маршрута.

        У общественного транспорта настоящего профиля нет — для красивой линии
        по дорогам используем автомобильную геометрию (время пересчитаем сами).
        """
        return TRANSPORT_TO_GEOMETRY_PROFILE.get(transport)

    def matrix(self, coordinates: list[tuple[float, float]], profile: str) -> OrsMatrix:
        """Возвращает матрицы расстояний и времени для профиля.

        Координаты — пары ``(широта, долгота)``. Результат кэшируется по
        профилю и координатам.
        """
        if not self.ors_enabled:
            raise OrsError("OpenRouteService отключён (нет ключа)")
        self._ensure_not_rate_limited()
        key = (profile, tuple((round(lat, 5), round(lon, 5)) for lat, lon in coordinates))
        cached = self._cache.get(key)
        if cached is not None:
            self._cache.move_to_end(key)
            return cached

        result = self._build_matrix(coordinates, profile)
        if self.cache_size:
            self._cache[key] = result
            self._cache.move_to_end(key)
            while len(self._cache) > self.cache_size:
                self._cache.popitem(last=False)
        return result

    def clear_cache(self) -> None:
        """Очищает кэш матриц и маршрутов."""
        self._cache.clear()
        self._route_cache.clear()

    def route_geometry(
        self,
        waypoints: list[tuple[float, float]],
        profile: str,
        *,
        transport: str | None = None,
    ) -> OrsRoute:
        """Строит дорожную геометрию маршрута через Directions API.

        ``waypoints`` — упорядоченные пары ``(широта, долгота)``. Если точек
        больше лимита ORS, запрос разбивается на части с перекрытием, а
        геометрия склеивается.

        Для ``transport='public_transport'`` геометрия и дистанция берутся
        автомобильные, а время пересчитывается эвристикой общественного
        транспорта (настоящего расписания у нас нет).
        """
        key = (
            profile,
            transport,
            tuple((round(lat, 5), round(lon, 5)) for lat, lon in waypoints),
        )
        cached = self._route_cache.get(key)
        if cached is not None:
            self._route_cache.move_to_end(key)
            return cached

        result = self._build_route(waypoints, profile, transport)
        # Визуальный «хак»: для не-авто берём только геометрию по улицам,
        # а дистанцию/время считаем математической моделью (Enterprise, Шаг 3).
        if transport and transport != "car":
            distance_km = _path_km(waypoints) * MATH_ROAD_FACTOR
            result = OrsRoute(
                profile=profile,
                coordinates=result.coordinates,
                distance_m=int(round(distance_km * 1000)),
                duration_s=math_travel_minutes(distance_km, transport) * 60,
                provider=result.provider,
            )
        if self.cache_size:
            self._route_cache[key] = result
            self._route_cache.move_to_end(key)
            while len(self._route_cache) > self.cache_size:
                self._route_cache.popitem(last=False)
        return result

    # --- Внутренняя реализация --------------------------------------------
    def _build_route(
        self,
        waypoints: list[tuple[float, float]],
        profile: str,
        transport: str | None = None,
    ) -> OrsRoute:
        """Запрашивает геометрию по частям и склеивает её в один полилайн."""
        if len(waypoints) < 2:
            raise OrsError("Для геометрии маршрута нужно минимум две точки")

        coordinates: list[list[float]] = []
        total_distance = 0.0
        total_duration = 0.0
        step = DIRECTIONS_MAX_WAYPOINTS - 1  # перекрытие 1 точка для склейки
        segments = 0
        providers: set[str] = set()

        for start in range(0, len(waypoints), step):
            chunk = waypoints[start : start + DIRECTIONS_MAX_WAYPOINTS]
            if len(chunk) < 2:
                break
            segment, distance, duration, provider = self._road_geometry(
                chunk, profile, transport
            )
            providers.add(provider)
            if not segment:
                raise OrsError("Не удалось получить геометрию маршрута")
            if coordinates:
                segment = segment[1:]  # убираем дубликат точки стыка
            coordinates.extend(segment)
            total_distance += distance
            total_duration += duration
            segments += 1

        if not coordinates:
            raise OrsError("Не удалось получить геометрию маршрута")

        if providers == {"local_osrm"}:
            used_provider = "local_osrm"
        elif providers == {"openrouteservice"}:
            used_provider = "openrouteservice"
        elif providers == {"osrm"}:
            used_provider = "osrm"
        else:
            used_provider = "mixed"

        logger.info(
            "Геометрия профиля %s по %s точкам собрана из %s сегмент(ов), источник: %s",
            profile,
            len(waypoints),
            segments,
            used_provider,
        )
        return OrsRoute(
            profile=profile,
            coordinates=coordinates,
            distance_m=int(round(total_distance)),
            duration_s=int(round(total_duration)),
            provider=used_provider,
        )

    def _directions(
        self, waypoints: list[tuple[float, float]], profile: str
    ) -> tuple[list[list[float]], float, float]:
        """Один запрос Directions: (координаты, метры, секунды).

        ``radiuses=-1`` отключает проверку радиуса снапа (по умолчанию 350 м),
        иначе точки вне дорожного графа роняют весь маршрут.
        """
        payload = {
            # ВАЖНО: ORS принимает [долгота, широта].
            "coordinates": [[lon, lat] for lat, lon in waypoints],
            "instructions": False,
            "radiuses": [-1] * len(waypoints),
        }
        response = self._post_json(
            f"{self.base_url}/v2/directions/{profile}/geojson", payload
        )
        feature = (response.get("features") or [{}])[0]
        segment = (feature.get("geometry") or {}).get("coordinates") or []
        if not segment:
            raise OrsError("ORS не вернул геометрию маршрута")
        summary = (feature.get("properties") or {}).get("summary") or {}
        return (
            segment,
            float(summary.get("distance") or 0.0),
            float(summary.get("duration") or 0.0),
        )

    def _road_geometry(
        self,
        waypoints: list[tuple[float, float]],
        profile: str,
        transport: str | None = None,
    ) -> tuple[list[list[float]], float, float, str]:
        """Дорожная геометрия по виду транспорта.

        Машина и общественный транспорт (автобус едет по дорогам): локальный OSRM → ORS → облачный
        OSRM. Пешком и велосипед: ORS → облачный OSRM (FOSSGIS, профили foot/bike, без ключа) →
        локальный OSRM (автомобильный граф — лучше прямой) → посегментно.

        Возвращает (координаты, метры, секунды, источник).
        """
        car_like = profile == "driving-car"
        # 1) Локальный OSRM знает только автомобильный граф — основной провайдер для машины.
        if self.local_osrm is not None and car_like:
            try:
                segment, distance, duration = self.local_osrm.route(waypoints)
                return segment, distance, duration, "local_osrm"
            except Exception as exc:  # noqa: BLE001
                logger.warning("Локальный OSRM недоступен (%s) — глубокий фолбэк", exc)
        # 2) Облачный OpenRouteService.
        if self.ors_enabled:
            try:
                segment, distance, duration = self._directions(waypoints, profile)
                return segment, distance, duration, "openrouteservice"
            except OrsError as exc:
                logger.warning("ORS недоступен (%s) — пробую облачный OSRM", exc)
        # 3) Облачный OSRM (FOSSGIS): свой профиль для машины, велосипеда и пешехода.
        try:
            segment, distance, duration = self._osrm_directions(waypoints, profile)
            return segment, distance, duration, "osrm"
        except OrsError as exc:
            logger.warning("OSRM недоступен (%s) — строю посегментно", exc)
        # 3а) Пешком и велосипед: автомобильный граф локального OSRM — лучше прямой.
        if self.local_osrm is not None and not car_like:
            try:
                segment, distance, duration = self.local_osrm.route(waypoints)
                return segment, distance, duration, "local_osrm"
            except Exception as exc:  # noqa: BLE001
                logger.warning("Локальный OSRM недоступен (%s) — строю посегментно", exc)
        # 4) Посегментно, недостижимые рёбра — прямые.
        segment, distance, duration = self._directions_leg_by_leg(
            waypoints, profile, transport
        )
        return segment, distance, duration, "mixed"

    def _osrm_directions(
        self, waypoints: list[tuple[float, float]], profile: str
    ) -> tuple[list[list[float]], float, float]:
        """Запасной роутер FOSSGIS OSRM (driving/cycling/foot), без ключа."""
        if not self.osrm_enabled:
            raise OrsError("OSRM отключён")
        osrm_profile = OSRM_PROFILE_BY_ORS.get(profile)
        if osrm_profile is None:
            raise OrsError(f"Нет OSRM-профиля для {profile}")
        coords = ";".join(f"{lon},{lat}" for lat, lon in waypoints)
        query = urllib.parse.urlencode(
            {"overview": "full", "geometries": "geojson", "steps": "false"}
        )
        url = (
            f"{self.osrm_base_url}/routed-{osrm_profile}/route/v1/"
            f"{osrm_profile}/{coords}?{query}"
        )
        request = urllib.request.Request(url, headers={"User-Agent": "beeline-rps/1.0"})
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                data = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:200]
            raise OrsError(f"OSRM ответил HTTP {exc.code}: {detail}") from exc
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise OrsError(f"OSRM недоступен: {exc}") from exc
        routes = data.get("routes") or []
        if not routes:
            raise OrsError("OSRM не вернул маршрут")
        route = routes[0]
        segment = (route.get("geometry") or {}).get("coordinates") or []
        if not segment:
            raise OrsError("OSRM не вернул геометрию")
        return segment, float(route.get("distance") or 0.0), float(route.get("duration") or 0.0)

    def _directions_leg_by_leg(
        self,
        waypoints: list[tuple[float, float]],
        profile: str,
        transport: str | None = None,
    ) -> tuple[list[list[float]], float, float]:
        """Строит маршрут по парам точек; недостижимые рёбра — прямые."""
        coordinates: list[list[float]] = []
        total_distance = 0.0
        total_duration = 0.0
        for index in range(len(waypoints) - 1):
            start_point, end_point = waypoints[index], waypoints[index + 1]
            leg: tuple[list[list[float]], float, float] | None = None
            if self.local_osrm is not None and profile == "driving-car":
                try:
                    leg = self.local_osrm.route([start_point, end_point])
                except Exception:  # noqa: BLE001
                    leg = None
            if leg is None:
                leg = self._single_leg(start_point, end_point, profile)
            if leg is None:
                if not coordinates:
                    coordinates.append([start_point[1], start_point[0]])
                coordinates.append([end_point[1], end_point[0]])
                continue
            segment, distance, duration = leg
            if coordinates and segment:
                segment = segment[1:]
            coordinates.extend(segment)
            total_distance += distance
            total_duration += duration
        return coordinates, total_distance, total_duration

    def _single_leg(
        self,
        start_point: tuple[float, float],
        end_point: tuple[float, float],
        profile: str,
    ) -> tuple[list[list[float]], float, float] | None:
        """Одно ребро: ORS → облачный OSRM; ``None`` — недостижимо."""
        if self.ors_enabled:
            try:
                return self._directions([start_point, end_point], profile)
            except OrsError:
                pass
        try:
            return self._osrm_directions([start_point, end_point], profile)
        except OrsError:
            return None

    def _build_matrix(self, coordinates: list[tuple[float, float]], profile: str) -> OrsMatrix:
        """Считает полную матрицу блоками и собирает её из ответов ORS."""
        size = len(coordinates)
        distances = [[0] * size for _ in range(size)]
        durations = [[0] * size for _ in range(size)]
        blocks = 0

        for source_start in range(0, size, self.chunk_size):
            source_indices = list(range(source_start, min(source_start + self.chunk_size, size)))
            for destination_start in range(0, size, self.chunk_size):
                destination_indices = list(
                    range(destination_start, min(destination_start + self.chunk_size, size))
                )
                locations = [
                    [coordinates[index][1], coordinates[index][0]]
                    for index in source_indices + destination_indices
                ]
                payload = {
                    "locations": locations,
                    "sources": list(range(len(source_indices))),
                    "destinations": list(
                        range(len(source_indices), len(source_indices) + len(destination_indices))
                    ),
                    "metrics": ["distance", "duration"],
                    "units": "m",
                }
                response = self._post_json(
                    f"{self.base_url}/v2/matrix/{profile}", payload
                )
                blocks += 1
                self._fill_block(
                    response,
                    distances,
                    durations,
                    source_indices,
                    destination_indices,
                )

        logger.info(
            "ORS: матрица %s×%s для профиля %s собрана из %s блок(ов)",
            size,
            size,
            profile,
            blocks,
        )
        return OrsMatrix(
            profile=profile,
            distance_m=distances,
            duration_min=durations,
            sources_count=size,
            destinations_count=size,
        )

    @staticmethod
    def _fill_block(
        response: dict,
        distances: list[list[int]],
        durations: list[list[int]],
        source_indices: list[int],
        destination_indices: list[int],
    ) -> None:
        """Переносит блок ответа ORS в общие матрицы.

        Недостижимые пары ORS возвращает как ``null`` — для них остаётся 0,
        а адаптер позже подставляет резервную оценку.
        """
        block_distances = response.get("distances") or []
        block_durations = response.get("durations") or []
        for row, source_index in enumerate(source_indices):
            distance_row = block_distances[row] if row < len(block_distances) else []
            duration_row = block_durations[row] if row < len(block_durations) else []
            for column, destination_index in enumerate(destination_indices):
                if source_index == destination_index:
                    continue
                raw_distance = distance_row[column] if column < len(distance_row) else None
                raw_duration = duration_row[column] if column < len(duration_row) else None
                if raw_distance is not None:
                    distances[source_index][destination_index] = int(round(float(raw_distance)))
                if raw_duration is not None:
                    durations[source_index][destination_index] = int(
                        math.ceil(float(raw_duration) / 60.0)
                    )

    def _post_json(self, url: str, payload: dict) -> dict:
        """Отправляет POST-запрос к ORS с ретраями на 5xx.

        На 429 включаем cooldown и сразу отдаём ошибку — не ретраим с паузами
        (иначе синхронные ручки вроде плана висят минутами).
        """
        if not self.ors_enabled:
            raise OrsError("OpenRouteService отключён (нет ключа)")
        self._ensure_not_rate_limited()
        body = json.dumps(payload).encode("utf-8")
        last_error: Exception | None = None

        for attempt in range(self.max_retries + 1):
            request = urllib.request.Request(
                url,
                data=body,
                method="POST",
                headers={
                    "Authorization": self.api_key,
                    "Content-Type": "application/json",
                },
            )
            try:
                with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                    return json.loads(response.read().decode("utf-8"))
            except urllib.error.HTTPError as exc:
                detail = exc.read().decode("utf-8", errors="replace")[:300]
                last_error = OrsError(f"ORS ответил HTTP {exc.code}: {detail}")
                if exc.code == 429:
                    self._rate_limited_until = (
                        time.monotonic() + self.rate_limit_cooldown_seconds
                    )
                    logger.warning(
                        "ORS: 429 Rate Limit, cooldown %.0f с",
                        self.rate_limit_cooldown_seconds,
                    )
                    raise last_error from exc
                if exc.code == 403 or "quota" in detail.lower():
                    # Дневная квота исчерпана — длинный cooldown, идём через OSRM.
                    self._rate_limited_until = (
                        time.monotonic() + self.quota_cooldown_seconds
                    )
                    logger.warning(
                        "ORS: квота исчерпана (HTTP %s), cooldown %.0f с, используем OSRM",
                        exc.code,
                        self.quota_cooldown_seconds,
                    )
                    raise last_error from exc
                if exc.code in _RETRYABLE_STATUS and attempt < self.max_retries:
                    time.sleep(2.0 * (attempt + 1))
                    continue
                raise last_error from exc
            except (urllib.error.URLError, TimeoutError, OSError) as exc:
                last_error = OrsError(f"ORS недоступен: {exc}")
                if attempt < self.max_retries:
                    time.sleep(2.0 * (attempt + 1))
                    continue
                raise last_error from exc

        raise last_error or OrsError("Не удалось получить матрицу ORS")

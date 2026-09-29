"""Настоящий геокодер с кэшем в БД (п. 15).

Провайдеры:
* ``yandex`` — HTTP Геокодер Яндекса (ключ «JavaScript API и HTTP Геокодер»);
* ``nominatim`` — OpenStreetMap Nominatim (без ключа, но с лимитами);
* ``none`` — геокодер не настроен (используется демо-функция).

Результат каждого адреса кладётся в таблицу ``geocode_cache``, поэтому повторные
импорты не ходят в сеть. Не нашли адрес — вызывающий код ставит точку офиса.
"""
from __future__ import annotations

import json
import logging
import re
import urllib.error
import urllib.parse
import urllib.request

from app.core.config import Settings

logger = logging.getLogger(__name__)

_USER_AGENT = "beeline-rps/1.0 (route planning API)"


class Geocoder:
    """Обёртка над внешним геокодером с кэшем в репозитории."""

    def __init__(self, repository, settings: Settings) -> None:
        self.repository = repository
        self.settings = settings

    @property
    def provider(self) -> str:
        """Эффективный провайдер: yandex требует ключ, иначе Nominatim/None."""
        configured = (self.settings.geocoder_provider or "none").strip().lower()
        if configured == "yandex" and self.settings.yandex_geocoder_api_key:
            return "yandex"
        if configured == "yandex":
            return "nominatim"
        if configured in {"yandex", "nominatim"}:
            return configured
        return "none"

    def geocode(self, address: str | None) -> tuple[float, float] | None:
        """Возвращает ``(latitude, longitude)`` или ``None`` (в т.ч. при сбое сети).

        Если основной провайдер — Yandex и он не ответил/не нашёл, пробуем
        Nominatim (ключ Яндекса может быть не активирован или ограничен).
        """
        if not address or not address.strip():
            return None
        key = address.strip()
        cached = self.repository.get_geocode(key)
        if cached is not None and self._in_bbox(cached.latitude, cached.longitude):
            return cached.latitude, cached.longitude
        if self.provider == "none":
            return None
        providers = [self.provider]
        if self.provider == "yandex":
            providers.append("nominatim")
        for provider in providers:
            try:
                coords = (
                    self._yandex(key) if provider == "yandex" else self._nominatim(key)
                )
            except Exception as exc:  # noqa: BLE001 — геокодер не должен ронять запрос
                logger.warning("Геокодер %s не сработал для «%s»: %s", provider, key, exc)
                continue
            if coords is None:
                continue
            if not self._in_bbox(*coords):
                # Геокодер вернул точку вне рамки региона (например, при
                # неточном адресе) — считаем адрес ненайденным.
                logger.warning(
                    "Геокодер %s вернул точку вне рамки для «%s»: %s", provider, key, coords
                )
                continue
            self.repository.upsert_geocode(key, coords[0], coords[1], provider)
            return coords
        return None

    def _in_bbox(self, latitude: float, longitude: float) -> bool:
        """Лежит ли точка в рамке региона ``GEOCODER_BBOX`` (lon1,lat1~lon2,lat2)."""
        raw = (self.settings.geocoder_bbox or "").strip()
        if not raw or "~" not in raw or "," not in raw:
            return True
        try:
            first, second = raw.split("~", 1)
            lon1, lat1 = (float(item) for item in first.split(",", 1))
            lon2, lat2 = (float(item) for item in second.split(",", 1))
        except (ValueError, TypeError):
            return True
        lat_min, lat_max = sorted((lat1, lat2))
        lon_min, lon_max = sorted((lon1, lon2))
        return lat_min <= latitude <= lat_max and lon_min <= longitude <= lon_max

    # --- Провайдеры --------------------------------------------------------
    def _yandex(self, address: str) -> tuple[float, float] | None:
        params = {
            "apikey": self.settings.yandex_geocoder_api_key,
            "format": "json",
            "geocode": address,
            "results": 1,
            "bbox": self.settings.geocoder_bbox,
            "rspn": 1,
        }
        url = "https://geocode-maps.yandex.ru/1.x/?" + urllib.parse.urlencode(params)
        data = self._get_json(url)
        members = (
            data.get("response", {})
            .get("GeoObjectCollection", {})
            .get("featureMember", [])
        )
        if not members:
            return None
        pos = members[0].get("GeoObject", {}).get("Point", {}).get("pos")
        if not pos:
            return None
        lon_str, lat_str = pos.split(" ")[:2]
        return float(lat_str), float(lon_str)

    def _nominatim(self, address: str) -> tuple[float, float] | None:
        # Nominatim не понимает «г.» и «д.» — чистим адрес.
        query = re.sub(r"(?<![а-яa-z])г\.\s*", "", address, flags=re.IGNORECASE)
        query = re.sub(r"(?<![а-яa-z])д\.\s*", " ", query, flags=re.IGNORECASE)
        query = re.sub(r"\s+", " ", query).strip(" ,")
        params = {"q": query, "format": "json", "limit": 1, "countrycodes": "ru"}
        url = self.settings.geocoder_nominatim_url + "?" + urllib.parse.urlencode(params)
        data = self._get_json(url)
        if not isinstance(data, list) or not data:
            return None
        return float(data[0]["lat"]), float(data[0]["lon"])

    def _get_json(self, url: str):
        request = urllib.request.Request(url, headers={"User-Agent": _USER_AGENT})
        with urllib.request.urlopen(request, timeout=self.settings.geocoder_timeout_seconds) as response:
            return json.loads(response.read().decode("utf-8"))

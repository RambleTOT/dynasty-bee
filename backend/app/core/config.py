"""Конфигурация приложения.

Все параметры читаются из переменных окружения (или файла ``.env``) с помощью
pydantic-settings. Значения по умолчанию рассчитаны на локальный запуск с SQLite.
"""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# Корень репозитория: backend/app/core/config.py -> parents[3]
REPO_ROOT = Path(__file__).resolve().parents[3]
BACKEND_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    """Настройки сервиса, переопределяемые через переменные окружения."""

    model_config = SettingsConfigDict(
        env_file=(".env", "backend/.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- Общие настройки ---------------------------------------------------
    app_name: str = "Beeline RPS API"
    app_version: str = "1.0.0"
    api_v1_prefix: str = "/api/v1"
    debug: bool = False
    log_level: str = "INFO"

    # --- Хранение ----------------------------------------------------------
    # По умолчанию — SQLite-файл рядом с backend. Для PostgreSQL задайте,
    # например: postgresql+psycopg://user:pass@db:5432/beeline
    database_url: str = f"sqlite:///{BACKEND_ROOT / 'beeline.db'}"

    # --- Алгоритм ----------------------------------------------------------
    # Путь к каталогу с пакетом dispatch (опционально). Если не задан,
    # используется routing_algorithm/beeline_optimizer_v2_final в корне репозитория.
    algorithm_path: str | None = None
    solver_seed: int = 42
    # Общий бюджет оптимизации и его разбиение по фазам v2 (секунды).
    solver_total_seconds: float = 20.0
    solver_warm_start_seconds: float = 5.0
    solver_pre_master_seconds: float = 2.0
    solver_lex_cg_seconds: float = 9.0
    solver_final_mip_seconds: float = 4.0

    # --- Ограничения входных данных ---------------------------------------
    max_engineers: int = 50
    max_requests: int = 200

    # --- Геоданные ---------------------------------------------------------
    # Дорожный коэффициент: во сколько раз реальный пробег длиннее прямой.
    # Используется только в резервном режиме, когда OpenRouteService недоступен.
    road_factor: float = 1.28
    # Разрешить детерминированное демонстрационное геокодирование адресов,
    # если в заявке нет координат (не является реальным геокодером).
    allow_demo_geocoding: bool = True
    # Настоящий геокодер с кэшем в БД (п. 15): yandex | nominatim | none.
    geocoder_provider: str = "none"
    yandex_geocoder_api_key: str | None = None
    geocoder_timeout_seconds: float = 6.0
    # Рамка Московского региона для Яндекса: lon1,lat1~lon2,lat2.
    geocoder_bbox: str = "35.1,54.2~40.3,57.0"
    geocoder_nominatim_url: str = "https://nominatim.openstreetmap.org/search"
    # Прогревать JIT-ядро алгоритма при старте (первый запрос будет быстрее).
    algorithm_warmup: bool = True

    # --- OpenRouteService (расчёт по дорожной сети) ------------------------
    # Ключ Matrix API. Если не задан, используется резервная оценка по прямой.
    ors_api_key: str | None = None
    ors_base_url: str = "https://api.openrouteservice.org"
    ors_timeout_seconds: float = 30.0
    # Размер блока матрицы (источники/назначения) на один запрос к ORS.
    ors_chunk_size: int = 50
    # Сколько матриц хранить в памяти процесса (LRU-кэш).
    ors_cache_size: int = 256
    # Cooldown после 429 от ORS: не долбим сервис, откатываемся на прямые.
    ors_rate_limit_cooldown_seconds: float = 60.0
    # Cooldown после исчерпания дневной квоты (403): квоты сбрасываются,
    # поэтому периодически пробуем ORS снова (по умолчанию 5 минут).
    ors_quota_cooldown_seconds: float = 300.0
    # Запасной бесплатный роутер геометрии (FOSSGIS OSRM) при недоступности ORS.
    osrm_geometry_fallback: bool = True
    osrm_base_url: str = "https://routing.openstreetmap.de"
    # --- Локальный OSRM (car) — основной провайдер (Enterprise) -------------
    osrm_local_enabled: bool = True
    osrm_local_url: str = "http://osrm:5000"
    osrm_local_timeout_seconds: float = 15.0
    osrm_local_cache_size: int = 256

    # --- CORS --------------------------------------------------------------
    # Список источников через запятую или "*". Фронт ходит через свой домен,
    # поэтому по умолчанию разрешены только домены стенда (S5).
    cors_origins: str = (
        "https://bee-dynasty.ru,https://bee-dynasty.ru:8443,https://bee-dynasty.ru:9443"
    )

    # --- Авторизация (JWT, роли) -------------------------------------------
    # /health и /auth/login открыты; остальные ручки — по токену (Bearer).
    auth_enabled: bool = True
    jwt_secret: str = "change-me-in-production"
    jwt_expire_days: int = 21
    demo_password: str = "demo2026"
    # Часовой пояс «реального времени» (D-19).
    timezone: str = "Europe/Moscow"
    # Сид демо-дня Востока на сегодня с часами (D-24), чтобы стенд работал 24/7.
    seed_demo_day: bool = True
    demo_clock: str = "12:30"

    # --- Стенд -------------------------------------------------------------
    # Массовые DELETE разрешены только пока ALLOW_DESTRUCTIVE=true.
    allow_destructive: bool = True
    # Регион по умолчанию для /data/load-demo.
    default_region_id: str = "east"

    # --- Демо-данные -------------------------------------------------------
    demo_scenario_path: Path = BACKEND_ROOT / "app" / "data" / "demo_scenario.json"

    @property
    def cors_origin_list(self) -> list[str]:
        """Преобразует строку CORS в список источников."""
        value = self.cors_origins.strip()
        if not value or value == "*":
            return ["*"]
        return [item.strip() for item in value.split(",") if item.strip()]

    @property
    def algorithm_dir(self) -> Path:
        """Определяет каталог с пакетом алгоритма ``dispatch``."""
        if self.algorithm_path:
            candidate = Path(self.algorithm_path).expanduser().resolve()
        else:
            candidate = REPO_ROOT / "routing_algorithm" / "beeline_optimizer_v2_final"
        return candidate

    def resolve_database_url(self) -> str:
        """Подставляет абсолютный путь для SQLite, если он относительный."""
        url = self.database_url
        prefix = "sqlite:///"
        if url.startswith(prefix):
            raw = url[len(prefix):]
            if raw and raw != ":memory:" and not raw.startswith("/"):
                return prefix + str((BACKEND_ROOT / raw).resolve())
        return url


@lru_cache
def get_settings() -> Settings:
    """Возвращает единственный экземпляр настроек (кэшируется)."""
    return Settings()


# Позволяет переопределить путь к алгоритму без .env (используется в тестах).
def override_algorithm_path(path: str | os.PathLike[str]) -> None:
    """Принудительно задаёт путь к алгоритму и сбрасывает кэш настроек."""
    os.environ["ALGORITHM_PATH"] = str(path)
    get_settings.cache_clear()

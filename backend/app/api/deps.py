"""Зависимости FastAPI: доступ к настройкам, адаптеру, планировщику и репозиторию."""
from __future__ import annotations

from functools import lru_cache

from fastapi import Depends, HTTPException, Request, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.services.algorithm_adapter import AlgorithmAdapter
from app.services.auth_service import AuthUser, decode_token, user_from_claims
from app.services.local_osrm import LocalOsrmClient
from app.services.ors_client import OpenRouteServiceClient
from app.services.planner_service import PlannerService
from app.services.replan_engine import ReplanEngine
from app.services.strategy_service import StrategyService
from app.storage.database import get_db
from app.storage.repository import Repository


def build_local_osrm_client(settings: Settings) -> LocalOsrmClient | None:
    """Создаёт клиент локального OSRM (если включён)."""
    if not settings.osrm_local_enabled:
        return None
    return LocalOsrmClient(
        base_url=settings.osrm_local_url,
        timeout_seconds=settings.osrm_local_timeout_seconds,
        cache_size=settings.osrm_local_cache_size,
    )


def build_ors_client(
    settings: Settings, local_osrm: LocalOsrmClient | None = None
) -> OpenRouteServiceClient | None:
    """Создаёт облачный ORS-клиент (он же несёт локальный OSRM для геометрии).

    Клиент создаётся, если есть ключ ORS, включён локальный OSRM или бесплатный облачный OSRM
    (FOSSGIS) — тогда линии на карте идут по дорогам и без ключа.
    """
    if not settings.ors_api_key and local_osrm is None and not settings.osrm_geometry_fallback:
        return None
    return OpenRouteServiceClient(
        api_key=settings.ors_api_key or "",
        base_url=settings.ors_base_url,
        timeout_seconds=settings.ors_timeout_seconds,
        chunk_size=settings.ors_chunk_size,
        cache_size=settings.ors_cache_size,
        rate_limit_cooldown_seconds=settings.ors_rate_limit_cooldown_seconds,
        quota_cooldown_seconds=settings.ors_quota_cooldown_seconds,
        osrm_base_url=settings.osrm_base_url,
        osrm_enabled=settings.osrm_geometry_fallback,
        local_osrm=local_osrm,
    )


@lru_cache
def get_local_osrm_client() -> LocalOsrmClient | None:
    """Единый клиент локального OSRM на процесс."""
    return build_local_osrm_client(get_settings())


@lru_cache
def get_ors_client() -> OpenRouteServiceClient | None:
    """Единый дорожный клиент на процесс (локальный OSRM + облачный ORS)."""
    return build_ors_client(get_settings(), get_local_osrm_client())


@lru_cache
def get_adapter() -> AlgorithmAdapter:
    """Единый адаптер алгоритма на процесс."""
    settings = get_settings()
    return AlgorithmAdapter(
        algorithm_dir=settings.algorithm_dir,
        road_factor=settings.road_factor,
        allow_demo_geocoding=settings.allow_demo_geocoding,
        ors_client=get_ors_client(),
        local_osrm=get_local_osrm_client(),
    )


@lru_cache
def get_planner_service() -> PlannerService:
    """Единый сервис планирования на процесс."""
    return PlannerService(get_adapter(), get_settings())


@lru_cache
def get_replan_engine() -> ReplanEngine:
    """Единый движок перепланирования на процесс."""
    return ReplanEngine(get_adapter(), get_planner_service())


@lru_cache
def get_strategy_service() -> StrategyService:
    """Единый сервис сравнения стратегий."""
    return StrategyService(get_adapter())


def get_repository(session: Session = Depends(get_db)) -> Repository:
    """Репозиторий, привязанный к текущей сессии БД."""
    return Repository(session)


def get_app_settings() -> Settings:
    """Настройки приложения как зависимость FastAPI."""
    return get_settings()


# --- Авторизация (JWT, роли) -----------------------------------------------
#: Схема безопасности для Swagger: кнопка Authorize принимает Bearer-токен.
bearer_scheme = HTTPBearer(
    auto_error=False,
    description=(
        "Вставьте только `access_token` из ответа `POST /api/v1/auth/login` "
        "(без слова «Bearer» — Swagger добавит его сам). Демо-логины выдаются "
        "организаторами отдельно."
    ),
)

#: Пути, доступные без токена.
OPEN_PATHS = {"/health", "/auth/login", "/docs", "/openapi.json", "/redoc", "/openapi.json/", "/", "/api/v1/realtime/ws"}


def _normalize_token(value: str | None) -> str | None:
    """Убирает любые повторные префиксы ``Bearer`` и пробелы."""
    if not value:
        return None
    token = value.strip()
    while token.lower().startswith("bearer "):
        token = token[7:].strip()
    return token or None


def extract_token(headers) -> str | None:
    """Достаёт токен из ``Authorization``/``X-API-Token``.

    Терпимо к типичным ошибкам: лишнему префиксу ``Bearer`` (Swagger сам его
    добавляет), пробелам, сырому токену в заголовке без схемы.
    """
    return _normalize_token(headers.get("authorization") or headers.get("x-api-token"))


def verify_token(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Security(bearer_scheme),
) -> AuthUser:
    """Проверяет JWT и возвращает пользователя. В OpenAPI добавляет схему Bearer."""
    settings = get_settings()
    if not settings.auth_enabled:
        return AuthUser(id="dev", login="dev", name="dev", role="dispatcher", region_ids=[])
    token = (
        _normalize_token(credentials.credentials)
        if credentials
        else extract_token(request.headers)
    )
    claims = decode_token(token, settings.jwt_secret) if token else None
    if not claims:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": {"code": "UNAUTHORIZED", "message": "Неверный или истёкший токен"}},
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user_from_claims(claims)


def get_current_user(user: AuthUser = Depends(verify_token)) -> AuthUser:
    """Текущий пользователь (зависимость)."""
    return user


def require_roles(*roles: str):
    """Зависимость: разрешает доступ только указанным ролям (иначе 403)."""

    def _checker(user: AuthUser = Depends(get_current_user)) -> AuthUser:
        if get_settings().auth_enabled and user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={"error": {"code": "FORBIDDEN", "message": "Недостаточно прав для этой роли"}},
            )
        return user

    return _checker


def role_allows(role: str, path: str) -> bool:
    """Проверяет доступ роли к пути (правила D-17)."""
    api = "/api/v1"
    # Профиль и выход доступны любой роли (нужны инженеру для входа/перезагрузки).
    if path in {f"{api}/auth/me", f"{api}/auth/logout", f"{api}/realtime/ticket"}:
        return True
    # Сокет авторизуется билетом, а не заголовком (п. 38).
    if path == f"{api}/realtime/ws":
        return True
    if role == "dispatcher":
        return not path.startswith(f"{api}/engineers/me")
    if role == "operator":
        if path in {f"{api}/regions"}:
            return True
        if path == f"{api}/events/apply":
            return True  # только срочная заявка — проверяется в обработчике
        return path.startswith(f"{api}/booking")
    if role == "engineer":
        return path.startswith(f"{api}/engineers/me")
    return False


def require_destructive() -> None:
    """Запрещает массовые операции удаления, если ALLOW_DESTRUCTIVE=false."""
    from fastapi import HTTPException, status

    if not get_settings().allow_destructive:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "error": {
                    "code": "DESTRUCTIVE_DISABLED",
                    "message": "Массовые удаления отключены на стенде (ALLOW_DESTRUCTIVE=false)",
                }
            },
        )

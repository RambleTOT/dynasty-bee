"""Точка входа FastAPI: сборка приложения, middleware и маршруты."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.deps import OPEN_PATHS, extract_token, role_allows
from app.api.routes import auth, booking, calendar, data, engineers, events, planning, realtime, regions, visualization
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.schemas.common import HealthResponse
from app.services.algorithm_adapter import algorithm_available
from app.services.auth_service import decode_token, seed_demo_users
from app.services.warmup import warm_up_algorithm
from app.storage.database import SessionLocal, init_db
from app.storage.repository import Repository

settings = get_settings()
logger = logging.getLogger(__name__)

_DESCRIPTION = """
API сервиса планирования маршрутов выездных инженеров для оператора связи.

Сервис — **сервисный слой** вокруг готового алгоритма оптимизации. Он решает
прикладные задачи диспетчера: распределяет заявки между инженерами, строит
маршруты по дорожной сети, показывает их на карте, объясняет решения простым
языком и перестраивает план после событий рабочего дня.

### Авторизация (JWT, роли)

1. Вызовите `POST /api/v1/auth/login` с телом `{"login":"<логин>","password":"<пароль>"}`.
2. Скопируйте `access_token` из ответа.
3. Нажмите **Authorize** вверху Swagger и вставьте **только токен** (без слова `Bearer`).
4. После этого защищённые ручки отвечают. `GET /auth/me` — проверка.

Без токена → `401 UNAUTHORIZED`; чужая роль → `403 FORBIDDEN`.
Роли: `dispatcher` (всё, кроме `/engineers/me/*`), `operator` (`/regions`, `/booking/*`,
срочные `/events/apply`), `engineer` (`/engineers/me/*`). Демо-учётки выдаются
организаторами отдельно. Открыты только `/health` и `/auth/login`.

### Как это работает (порядок вызовов)
1. **Загрузите данные** — `POST /api/v1/data/load-demo` (встроенный набор),
   `POST /api/v1/data/load` (JSON) или `POST /api/v1/data/load-files` (CSV/JSON).
   Ответ содержит `scenario_id`.
2. **Запустите планирование** — `POST /api/v1/planning/run` с `scenario_id`.
   Ответ содержит `plan_id`, распределение, маршруты, объяснения и метрики.
3. **Посмотрите маршруты** — откройте `GET /api/v1/visualization/{plan_id}/map`
   в браузере или заберите данные из `.../geojson`.
4. **Объясните решение** — `GET /api/v1/planning/{plan_id}/explanations` и поле
   `unassigned` (причины неназначения) в самом плане.
5. **Перестройте план** — `POST /api/v1/events/replan` (срочная заявка, отмена
   заявки или недоступность инженера).
6. **Сравните с базой** — `POST /api/v1/planning/baseline` (обязательные метрики).

### Сценарии перепланирования (S0–S14)

Единая ручка `POST /api/v1/events/apply` принимает любое событие дня
(S1–S14): срочная заявка, отмена, недоступность/возврат инженера, новая обычная
заявка, задержка, раннее завершение, смена транспорта, перенос окна, смена
объёма работ, ручное переназначение, продление смены, сдвиг окон. Прошлое
**замораживается**, перестраивается только будущее. `apply=false` создаёт версию
`proposed`, которую можно принять (`.../planning/{id}/apply`) или отклонить.

Дополнительно: `POST /api/v1/planning/compare` (стратегии), `.../reassign`,
`.../suggest`, `.../what-if`, `.../extend-resource`. Полное описание — в
`docs/REPLANNING_SCENARIOS.md`.

### Справочники (можно присылать русские названия или английские ключи)

| Сущность | Значения |
|---|---|
| Навык | `local` / «Локальные работы», `installation` / «Работы на подключение и дозаказы», `emergency` / «Аварийные работы» |
| Транспорт | `car` / «Автомобиль», `walk` / «Пешеход», `bike` / «Велосипед», `public_transport` / «Общественный транспорт» |
| Приоритет | `normal` / «Обычная», `urgent` / «Срочная» |

### Единицы измерения

* время — строка `HH:MM` (например, `"09:30"`);
* длительность и время в пути — минуты;
* расстояние — километры (во входных данных не задаётся, считается сервисом);
* координаты — широта/долгота в градусах (WGS84).

### Геоданные (локальный OSRM + математика)

* **Автомобиль** — локальный **OSRM** (профиль `car`, алгоритм MLD) в Docker:
  матрицы через `/table` и геометрия через `/route` (без внешних лимитов).
* **Пешеход / велосипед / общественный транспорт** — считаются в приложении:
  расстояние = гаверсинус × 1.3, время — walk 4.5 км/ч, bike 14 км/ч,
  ОТ — 18 км/ч + 10 мин (до 15 км) / 35 км/ч + 15 мин.
* **Геометрия для карты** — всегда автомобильная линия локального OSRM
  (красивая линия по улицам); для не-авто дистанция/время пересчитываются
  математикой.
* **Фолбэк:** локальный OSRM → облачный OpenRouteService → облачный OSRM → прямые.

Источник по транспорту — `algorithm_metadata.matrix_sources`
(`local_osrm:car`, `math:walk`, …), источник геометрии — `geometry_source`
(`local_osrm:car`, `local_osrm:car+walk`, `openrouteservice:*`, `straight_line`).

### Быстрая проверка (curl)

```bash
BASE=https://api.beeline-rps.ru/api/v1
SCENARIO=$(curl -s -X POST $BASE/data/load-demo | python -c "import sys,json;print(json.load(sys.stdin)['scenario_id'])")
PLAN=$(curl -s -X POST $BASE/planning/run -H 'Content-Type: application/json' \\
  -d "{\\"scenario_id\\":\\"$SCENARIO\\",\\"time_limit_seconds\\":5,\\"include_baseline\\":true}" \\
  | python -c "import sys,json;print(json.load(sys.stdin)['plan_id'])")
# карта маршрутов:
echo "$BASE/visualization/$PLAN/map"
```

### Допущения MVP

* адрес без координат геокодируется детерминированным демонстрационным способом;
* ORS учитывает дорожную сеть, но не live-трафик;
* нет авторизации — по условиям кейса это не требуется.
"""

_TAGS_METADATA = [
    {
        "name": "Служебные",
        "description": "Проверка работоспособности сервиса и информация о версии.",
    },
    {
        "name": "Данные",
        "description": (
            "Загрузка входных данных (инженеры и заявки) из JSON/CSV или встроенного "
            "демо-набора, просмотр и удаление сценариев."
        ),
    },
    {
        "name": "Планирование",
        "description": (
            "Запуск алгоритма, получение плана с маршрутами и объяснениями, "
            "сравнение с базовым сценарием, удаление планов."
        ),
    },
    {
        "name": "События",
        "description": (
            "Перепланирование после одного события рабочего дня (срочная заявка, "
            "отмена заявки, недоступность инженера) и журнал событий."
        ),
    },
    {
        "name": "Визуализация",
        "description": (
            "GeoJSON маршрутов и точек и готовая HTML-карта Leaflet/OpenStreetMap "
            "с дорожной геометрией."
        ),
    },
]


@asynccontextmanager
async def lifespan(_: FastAPI):
    """Инициализирует хранилище, создаёт демо-учётки и прогревает алгоритм."""
    configure_logging()
    init_db()
    session = SessionLocal()
    try:
        repository = Repository(session)
        seed_demo_users(repository)
        try:
            from app.services.demo_seed import seed_demo_day

            seed_demo_day(repository)
        except Exception as exc:  # noqa: BLE001 — сид не должен ронять сервис
            logger.warning("Не удалось создать демо-день: %s", exc)
    except Exception as exc:  # noqa: BLE001 — сид не должен ронять сервис
        logger.warning("Не удалось создать демо-пользователей: %s", exc)
    finally:
        session.close()
    # Событийный цикл для публикации живых обновлений (§38).
    try:
        import asyncio

        from app.realtime.hub import hub

        hub.bind_loop(asyncio.get_running_loop())
    except Exception:  # noqa: BLE001
        pass
    if settings.algorithm_warmup and algorithm_available(settings.algorithm_dir):
        warm_up_algorithm()
    yield


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description=_DESCRIPTION,
    openapi_tags=_TAGS_METADATA,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=settings.cors_origin_list != ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    """Авторизация по JWT и проверка роли. /health и /auth/login открыты."""
    path = request.url.path
    is_open = (
        path in OPEN_PATHS
        or path.endswith("/auth/login")
        or path.startswith("/docs")
        or path.startswith("/redoc")
    )
    if settings.auth_enabled and not is_open:
        token = extract_token(request.headers)
        claims = decode_token(token, settings.jwt_secret) if token else None
        if not claims:
            return JSONResponse(
                status_code=401,
                content={"error": {"code": "UNAUTHORIZED", "message": "Неверный или истёкший токен"}},
                headers={"WWW-Authenticate": "Bearer"},
            )
        if not role_allows(str(claims.get("role", "")), path):
            return JSONResponse(
                status_code=403,
                content={"error": {"code": "FORBIDDEN", "message": "Недостаточно прав для этой роли"}},
            )
    if request.method == "DELETE" and not settings.allow_destructive:
        return JSONResponse(
            status_code=403,
            content={
                "error": {
                    "code": "DESTRUCTIVE_DISABLED",
                    "message": "Массовые удаления отключены на стенде (ALLOW_DESTRUCTIVE=false)",
                }
            },
        )
    return await call_next(request)

app.include_router(auth.router, prefix=settings.api_v1_prefix)
app.include_router(calendar.router, prefix=settings.api_v1_prefix)
app.include_router(data.router, prefix=settings.api_v1_prefix)
app.include_router(planning.router, prefix=settings.api_v1_prefix)
app.include_router(events.router, prefix=settings.api_v1_prefix)
app.include_router(realtime.router, prefix=settings.api_v1_prefix)
app.include_router(visualization.router, prefix=settings.api_v1_prefix)
app.include_router(booking.router, prefix=settings.api_v1_prefix)
app.include_router(engineers.router, prefix=settings.api_v1_prefix)
# Регионы доступны и без префикса /api/v1 (служебный справочник).
app.include_router(regions.router, prefix=settings.api_v1_prefix)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    """Возвращает ошибки валидации в едином формате."""
    return JSONResponse(
        status_code=422,
        content=jsonable_encoder(
            {
                "detail": "Ошибка валидации входных данных",
                "code": "VALIDATION_ERROR",
                "context": {"errors": exc.errors()},
            }
        ),
    )


@app.get("/health", response_model=HealthResponse, tags=["Служебные"], summary="Проверка работоспособности")
def health() -> HealthResponse:
    """Проверяет доступность API, алгоритма и хранилища."""
    database = "sqlite" if settings.resolve_database_url().startswith("sqlite") else "postgresql"
    return HealthResponse(
        status="ok",
        app_version=settings.app_version,
        algorithm_available=algorithm_available(settings.algorithm_dir),
        database=database,
    )


@app.get("/", tags=["Служебные"], summary="Информация о сервисе")
def root() -> dict:
    """Возвращает базовую информацию и ссылки на документацию."""
    return {
        "service": settings.app_name,
        "version": settings.app_version,
        "docs": "/docs",
        "openapi": "/openapi.json",
        "api_prefix": settings.api_v1_prefix,
    }

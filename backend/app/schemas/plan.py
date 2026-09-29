"""Схемы планов, метрик, объяснений и результатов базового сценария."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

from app.schemas.validators import validate_time_string


class MetricBlock(BaseModel):
    """Набор обязательных метрик эффективности плана."""

    engineers_used: int = Field(..., description="Число задействованных инженеров", examples=[7])
    total_distance_km: float = Field(..., description="Суммарный пробег, км", examples=[278.5])
    planned_count: int = Field(..., description="Число выполненных заявок", examples=[45])
    total_requests: int = Field(..., description="Всего заявок в сценарии", examples=[45])
    unassigned_count: int = Field(..., description="Число неназначенных заявок", examples=[0])
    unassigned_urgent: int = Field(..., description="Число неназначенных срочных заявок", examples=[0])


class MetricsComparison(BaseModel):
    """Сравнение оптимизированного плана с базовым сценарием."""

    optimized: MetricBlock
    baseline: MetricBlock
    engineers_saved: int = Field(..., description="На сколько меньше инженеров задействовано")
    distance_saved_km: float = Field(..., description="Экономия пробега, км")
    distance_saved_percent: float = Field(..., description="Экономия пробега, %")
    extra_requests_planned: int = Field(..., description="На сколько больше заявок обслужено")


class PlanningRunRequest(BaseModel):
    """Параметры запуска оптимизации."""

    scenario_id: str | None = Field(
        None,
        description="ID сценария; если не задан, используется последний загруженный",
        examples=["3f1c9b2e-..."],
    )
    solver: Literal["hybrid_v2", "alns"] | None = Field(
        None,
        description=(
            "`hybrid_v2` — основной гибридный решатель (рекомендуется); "
            "`alns` — альтернативный поиск. По умолчанию — из настроек сервиса."
        ),
        examples=["hybrid_v2"],
    )
    seed: int | None = Field(None, description="Seed воспроизводимости результата", examples=[42])
    time_limit_seconds: float | None = Field(
        None,
        gt=0,
        le=300,
        description="Общий бюджет оптимизации в секундах (больше — качественнее план)",
        examples=[5],
    )
    include_baseline: bool = Field(
        True,
        description=(
            "Считать ли базовый сценарий (заявки по порядку, первый подходящий "
            "инженер) для сравнения метрик."
        ),
        examples=[True],
    )

    model_config = {
        "json_schema_extra": {
            "example": {
                "scenario_id": "3f1c9b2e-1a2b-3c4d-5e6f-7a8b9c0d1e2f",
                "solver": "hybrid_v2",
                "seed": 42,
                "time_limit_seconds": 5,
                "include_baseline": True,
            }
        }
    }


class RoutePoint(BaseModel):
    """Точка маршрута инженера (данные для карты)."""

    request_id: str
    sequence: int = Field(..., description="Порядковый номер точки в маршруте")
    latitude: float
    longitude: float
    address: str | None = None
    arrival: str = Field(..., description="Плановое время прибытия, HH:MM")
    start: str = Field(..., description="Плановое начало работ, HH:MM")
    end: str = Field(..., description="Плановое окончание работ, HH:MM")
    travel_minutes: int = Field(..., description="Время в пути от предыдущей точки, мин")
    leg_distance_km: float = Field(..., description="Пробег от предыдущей точки, км")
    waiting_minutes: int = Field(..., description="Ожидание до открытия окна, мин")
    window_start: str
    window_end: str
    required_skill: str
    required_skill_display: str
    status: str = Field("planned", description="Статус визита/заявки (§4.4).")
    flags: list[str] = Field(default_factory=list, description="Флаги заявки (§4.5).")
    slack_minutes: int | None = Field(None, description="Запас до нарушения окна, мин.")
    frozen: bool = Field(False, description="Визит заморожен (done/in_progress/en_route).")
    actual_arrival: str | None = None
    actual_start: str | None = None
    actual_end: str | None = None


class RouteOut(BaseModel):
    """Маршрут одного инженера."""

    engineer_id: str
    engineer_name: str
    transport: str
    transport_display: str
    skills: list[str]
    skills_display: list[str]
    shift_start: str
    shift_end: str
    start_latitude: float | None = Field(
        None, description="Широта стартовой точки инженера (начало маршрута)"
    )
    start_longitude: float | None = Field(
        None, description="Долгота стартовой точки инженера (начало маршрута)"
    )
    distance_km: float
    task_count: int
    route: list[RoutePoint] = Field(default_factory=list)
    geometry: list[list[float]] | None = Field(
        None,
        description=(
            "Дорожная геометрия маршрута для карты: список координат [долгота, широта] "
            "от старта до последней заявки. Строится через OpenRouteService; "
            "при недоступности — прямые отрезки (см. geometry_source)."
        ),
    )
    geometry_source: str | None = Field(
        None,
        description=(
            "Источник геометрии: 'openrouteservice:<профиль>' (например, "
            "openrouteservice:driving-car) или 'straight_line' (прямые отрезки)."
        ),
    )
    explanation: str = Field("", description="Краткое объяснение маршрута")


class AssignmentOut(BaseModel):
    """Назначение заявки на инженера."""

    request_id: str
    engineer_id: str
    engineer_name: str
    sequence: int = Field(..., description="Позиция в маршруте инженера (с 1)")
    window_start: str
    window_end: str
    arrival: str
    start: str
    required_skill: str


class UnassignedOut(BaseModel):
    """Неназначенная заявка с обязательной причиной."""

    request_id: str
    reason_code: str = Field(
        ...,
        description=(
            "Машинный код причины. Возможные значения: `NO_SKILL` (нет инженера с "
            "нужным навыком), `NO_SKILL_LEVEL` (недостаточный уровень квалификации), "
            "`NO_TRANSPORT` (нет нужного транспорта), `NO_EQUIPMENT` (нет оборудования), "
            "`NO_DIRECT_FEASIBLE_SLOT` (не помещается в окно и смену), "
            "`NO_CAPACITY` (подходящие инженеры заняты), "
            "`DISPATCHER_NOT_ASSIGNED` (нет назначения в плане диспетчера)."
        ),
        examples=["NO_SKILL"],
    )
    reason: str = Field(
        ...,
        description="Понятная диспетчеру причина на русском языке",
        examples=["Нет инженера с требуемым навыком «Аварийные работы»."],
    )
    proven_static: bool = Field(
        False, description="True — причина доказана статически, False — зависит от бюджета поиска"
    )


class ExplanationOut(BaseModel):
    """Понятное объяснение решения по заявке."""

    request_id: str
    status: Literal["assigned", "unassigned"]
    engineer_id: str | None = None
    engineer_name: str | None = None
    summary: str = Field(..., description="Итоговое объяснение")
    reasons: list[str] = Field(default_factory=list, description="Список учтённых факторов")
    schedule: dict[str, Any] | None = Field(None, description="Плановое время по заявке")
    local_alternatives: list[dict[str, Any]] = Field(
        default_factory=list, description="Локальные альтернативы переноса заявки"
    )


class PlanSummary(BaseModel):
    """Сводка по плану."""

    engineers_used: int
    total_distance_km: float
    planned_count: int
    total_requests: int
    unassigned_count: int
    unassigned_urgent: int
    objective: list[int] = Field(
        ..., description="Лексикографическая цель: [срочные не назначены, всего не назначено, инженеров, метры]"
    )
    elapsed_seconds: float | None = None


class PlanResponse(BaseModel):
    """Полный результат планирования, удобный для frontend и карты."""

    plan_id: str
    scenario_id: str | None
    parent_plan_id: str | None = None
    kind: str
    status: str
    version: int = Field(0, description="Номер версии дня (0 — черновик).")
    strategy: str = Field("ours", description="ours | fifo | dispatcher | incremental.")
    event_id: str | None = Field(None, description="Событие, породившее версию.")
    created_at: datetime
    summary: PlanSummary
    metrics: MetricsComparison | None = None
    routes: list[RouteOut] = Field(default_factory=list)
    assignments: list[AssignmentOut] = Field(default_factory=list)
    unassigned: list[UnassignedOut] = Field(default_factory=list)
    explanations: list[ExplanationOut] = Field(default_factory=list)
    changes: list[dict[str, Any]] = Field(
        default_factory=list,
        description=(
            "Изменения относительно предыдущего плана (заполняется при перепланировании). "
            "Каждый элемент: `task_id`, `before`/`after` как `[engineer_id, position]` "
            "(или `null`) и `kind` — `newly_assigned`, `reassigned`, `unassigned`, "
            "`position_changed`, `unchanged`."
        ),
    )
    violations: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Нарушения ограничений (например, при ручном переназначении с `force`).",
    )
    map_geojson: dict[str, Any] | None = Field(None, description="GeoJSON для Leaflet/OpenStreetMap")
    algorithm_metadata: dict[str, Any] = Field(default_factory=dict)


class PlanListItem(BaseModel):
    """Элемент списка планов."""

    plan_id: str
    scenario_id: str | None
    kind: str
    status: str
    version: int = 0
    event_id: str | None = None
    event_type: str | None = None
    headline: str | None = None
    created_at: datetime
    engineers_used: int
    total_distance_km: float
    planned_count: int


class PlanListResponse(BaseModel):
    """Список планов."""

    count: int
    items: list[PlanListItem]


class BaselineRequest(BaseModel):
    """Параметры запроса сравнения с базовым сценарием."""

    plan_id: str | None = Field(
        None, description="План для сравнения; если не задан, используется последний"
    )


class BaselineResponse(BaseModel):
    """Сравнение оптимизированного и базового планов."""

    plan_id: str
    optimized: MetricBlock
    baseline: MetricBlock
    comparison: MetricsComparison
    baseline_routes: list[RouteOut] = Field(default_factory=list)
    note: str = Field(
        "Базовый сценарий: заявки по порядку поступления, первый подходящий инженер, "
        "добавление только в конец маршрута (в соответствии с условиями кейса)."
    )

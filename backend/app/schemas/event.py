"""Схемы событий перепланирования (все сценарии S0–S14)."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

from app.schemas.plan import PlanResponse
from app.schemas.request import RequestIn
from app.schemas.validators import validate_time_string

#: Все поддерживаемые типы событий (старые имена — алиасы).
EventType = Literal[
    "urgent_order_added",
    "order_cancelled",
    "engineer_unavailable",
    "order_added",
    "engineer_delayed",
    "finished_early",
    "transport_changed",
    "order_window_changed",
    "engineer_available",
    "order_scope_changed",
    "manual_reassign",
    "extend_resource",
    "shift_windows",
    "engineer_added",
    # алиасы прежнего контракта
    "urgent_request",
    "request_cancelled",
]

#: Приведение старых имён к каноническим.
EVENT_ALIASES: dict[str, str] = {
    "urgent_request": "urgent_order_added",
    "request_cancelled": "order_cancelled",
}

#: События-факты применяются сразу; остальные по умолчанию — предложение (§4.6, §9).
_FACT_TYPES = {"engineer_delayed", "finished_early"}


def default_apply(event_type: str) -> bool:
    """Применять ли событие сразу по умолчанию."""
    return EVENT_ALIASES.get(event_type, event_type) in _FACT_TYPES

EventSource = Literal["dispatcher", "engineer", "client", "operator", "system"]


class EngineerTelemetry(BaseModel):
    """Явная телеметрия по инженеру на момент события (необязательна)."""

    engineer_id: str
    available_at: str | None = Field(
        None, description="С какого времени инженер свободен, HH:MM"
    )
    available: bool | None = Field(None, description="Доступен ли инженер")
    used_today: bool | None = Field(None, description="Работал ли уже сегодня")
    committed_task_ids: list[str] = Field(
        default_factory=list, description="Заявки, которые уже выполняются/в пути и заморожены"
    )
    status: str | None = Field(None, description="Текстовый статус (для информации)")


class ApplyEventRequest(BaseModel):
    """Единый запрос на применение одного события дня."""

    type: EventType = Field(..., description="Тип события")
    plan_id: str | None = Field(None, description="Исходный план; иначе последний сохранённый")
    time: str | None = Field(None, description="Время события, HH:MM (алиас `event_time`)")
    event_time: str | None = Field(None, description="Время события, HH:MM")
    source: EventSource = Field("dispatcher", description="Кто сообщил о событии")
    order_id: str | None = Field(None, description="ID заявки (для событий по заявке)")
    request_id: str | None = Field(
        None, description="ID заявки — устаревший алиас `order_id` (совместимость)"
    )
    engineer_id: str | None = Field(None, description="ID инженера (для событий по инженеру)")
    request: RequestIn | None = Field(None, description="Новая заявка (для добавления/срочной)")
    engineer: dict[str, Any] | None = Field(
        None,
        description=(
            "Новая бригада для события `engineer_added`: `name`, `skills`, `transport`, "
            "`shift_start`, `shift_end`, `start` ({kind: office|home}), опционально "
            "`latitude`/`longitude`/`kit`/`id`."
        ),
    )
    params: dict[str, Any] = Field(
        default_factory=dict,
        description=(
            "Параметры события, зависят от типа: `reason`, `from`, `to`, `finish_current`, "
            "`delay_min`, `where`, `actual_end`, `transport`, `window_start`, `window_end`, "
            "`extra_min`, `required_skill`, `extend_min`, `option`, `delta_min`, `position`, "
            "`to_engineer_id`, `force`."
        ),
    )
    telemetry: list[EngineerTelemetry] = Field(
        default_factory=list, description="Явные состояния инженеров (иначе выводятся из плана)"
    )
    apply: bool | None = Field(
        None,
        description=(
            "true — версия сразу applied; false — версия proposed. Если не задано — "
            "зависит от типа: факты (`engineer_delayed`, `finished_early`) применяются "
            "сразу, остальные события создают предложение."
        ),
    )
    solver: Literal["hybrid_v2", "alns"] | None = Field(None, description="Солвер")
    seed: int | None = Field(None, description="Seed воспроизводимости")
    time_limit_seconds: float | None = Field(None, gt=0, le=300, description="Бюджет, секунды")

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "type": "urgent_order_added",
                    "plan_id": "PLAN_ID",
                    "time": "13:10",
                    "source": "dispatcher",
                    "request": {
                        "id": "R-URG-1",
                        "latitude": 55.781,
                        "longitude": 37.712,
                        "duration_minutes": 80,
                        "window_start": "13:10",
                        "window_end": "18:00",
                        "priority": "urgent",
                        "required_skill": "emergency",
                    },
                },
                {
                    "type": "engineer_unavailable",
                    "plan_id": "PLAN_ID",
                    "time": "13:30",
                    "source": "dispatcher",
                    "engineer_id": "E01",
                    "params": {"from": "13:30", "to": None, "finish_current": True, "reason": "sick"},
                },
                {
                    "type": "order_cancelled",
                    "plan_id": "PLAN_ID",
                    "time": "12:40",
                    "source": "engineer",
                    "order_id": "R017",
                    "params": {"stage": "on_site", "reason": "client_refused"},
                },
            ]
        }
    }

    def event_time_value(self) -> str | None:
        """Возвращает время события из `time` или `event_time`."""
        return self.time or self.event_time

    def order_id_value(self) -> str | None:
        """ID заявки с учётом устаревшего алиаса `request_id`."""
        return self.order_id or self.request_id

    @model_validator(mode="after")
    def _validate_event(self) -> "ApplyEventRequest":
        if self.event_time_value():
            validate_time_string(self.event_time_value() or "")
        canonical = EVENT_ALIASES.get(self.type, self.type)
        if canonical == "urgent_order_added" and self.request is None:
            raise ValueError("Для срочной заявки требуется поле request")
        if canonical in {"order_cancelled", "order_window_changed", "order_scope_changed"} and not (
            self.order_id_value()
        ):
            raise ValueError(f"Для события {canonical} требуется order_id")
        if canonical in {
            "engineer_unavailable",
            "engineer_delayed",
            "finished_early",
            "transport_changed",
            "engineer_available",
        } and not self.engineer_id:
            raise ValueError(f"Для события {canonical} требуется engineer_id")
        if canonical == "engineer_added" and not (self.engineer or self.params.get("engineer")):
            raise ValueError("Для события engineer_added требуется поле engineer")
        return self


class ReplanResult(BaseModel):
    """Результат применения события: новый план, изменения и детали сценария."""

    event_id: str
    event_type: str
    previous_plan_id: str
    status: str = Field("applied", description="`applied` или `proposed`")
    plan: PlanResponse
    changes: list[dict[str, Any]] = Field(default_factory=list)
    change_summary: dict[str, int] = Field(default_factory=dict)
    applied_event: dict[str, Any] = Field(default_factory=dict)
    scenario: dict[str, Any] = Field(
        default_factory=dict, description="Детали конкретного сценария S1–S14"
    )
    violations: list[dict[str, Any]] = Field(default_factory=list)


class ReassignCheckResponse(BaseModel):
    """Проверка ручного переназначения заявки (S2)."""

    order_id: str
    to_engineer_id: str
    feasible: bool
    checks: dict[str, Any] = Field(default_factory=dict)
    new_start: str | None = None
    shifted_visits: list[dict[str, Any]] = Field(default_factory=list)
    late_visits: list[dict[str, Any]] = Field(default_factory=list)
    delta_km: float = 0.0


class SuggestionOut(BaseModel):
    """Подсказка по заявке для свободного промежутка (S8)."""

    order_id: str
    source: str = Field(..., description="`unassigned` или `at_risk`")
    priority: str = "normal"
    start: str | None = None
    delta_km: float = 0.0
    text: str = ""


class SuggestResponse(BaseModel):
    """Подсказки, кого поставить освободившемуся инженеру (S8)."""

    engineer_id: str
    from_time: str
    to_time: str
    suggestions: list[SuggestionOut] = Field(default_factory=list)


class CompareColumn(BaseModel):
    """Колонка сравнения стратегий планирования (S0)."""

    strategy: str | None = None
    available: bool = True
    engineers_used: int | None = None
    km_total: float | None = None
    coverage_pct: float | None = None
    unassigned_urgent: int | None = None
    unassigned: int | None = None
    visits_total: int | None = None
    started_in_window: int | None = None
    late: int | None = None
    violations: int = 0
    km_is_estimate: bool = False
    km_by_engineer: list[dict[str, Any]] = Field(default_factory=list)


class CompareResponse(BaseModel):
    """Сравнение стратегий планирования (S0)."""

    region_id: str | None = None
    columns: dict[str, CompareColumn] = Field(default_factory=dict)
    km_by_engineer: dict[str, Any] = Field(default_factory=dict)
    notes: list[str] = Field(default_factory=list)


class WhatIfResponse(BaseModel):
    """Песочница «что если» (S14): без сохранения версии."""

    delta_metrics: dict[str, float] = Field(default_factory=dict)
    summary: str = ""
    preview: dict[str, Any] | None = None


class ExtendResourceResponse(BaseModel):
    """Добор ресурса под неназначенные заявки (S13)."""

    plan: PlanResponse
    closed: list[str] = Field(default_factory=list)
    still_unassigned: list[str] = Field(default_factory=list)
    cost: dict[str, Any] = Field(default_factory=dict)


class ExtendResourceCheckResponse(BaseModel):
    """Расчёт добора ресурса без сохранения версии (DS-09)."""

    closed: list[str] = Field(default_factory=list)
    still_unassigned: list[str] = Field(default_factory=list)
    cost: dict[str, Any] = Field(default_factory=dict)


class PlanVersionResponse(BaseModel):
    """Ответ apply/reject версии плана."""

    plan_id: str
    status: str
    active_plan_id: str | None = None


class EventItem(BaseModel):
    """Запись журнала событий перепланирования."""

    event_id: str
    event_type: str
    plan_id: str | None = None
    scenario_id: str | None = None
    result_plan_id: str | None = None
    headline: str | None = Field(None, description="Одна строка для ленты диспетчера")
    source: str | None = Field(None, description="dispatcher | operator | engineer | system")
    event_time: str | None = Field(None, description="Время события HH:MM по часам дня")
    order_id: str | None = None
    engineer_id: str | None = None
    status: str | None = Field(None, description="Статус заявки после события")
    flag: str | None = Field(None, description="Флаг, если событие про смену флага")
    applied_at: str | None = Field(None, description="Когда предложение приняли, HH:MM")
    payload: dict[str, Any] = Field(default_factory=dict)
    needs_decision: bool = Field(
        False, description="Событие требует решения диспетчера (предложение/конфликт/вытеснение)."
    )
    created_at: datetime


# --- Обратная совместимость (deprecated) -----------------------------------
class ReplanRequest(ApplyEventRequest):
    """Устаревший контракт `/events/replan` (те же поля, что у ApplyEventRequest)."""


class ReassignRequest(BaseModel):
    """Запрос ручного переназначения (S2)."""

    plan_id: str | None = Field(None, description="План; иначе последний")
    order_id: str = Field(..., description="Какую заявку переносим")
    to_engineer_id: str = Field(..., description="Кому переносим")
    position: int | None = Field(None, ge=0, description="Позиция в маршруте; null — лучшая")
    force: bool = Field(False, description="Применить даже при нарушении ограничений (override)")
    time: str | None = Field(
        None, description="Время дня HH:MM для проверки «не раньше сейчас» (п. 47); иначе часы дня"
    )


class SuggestRequest(BaseModel):
    """Запрос подсказок для освободившегося инженера (S8)."""

    plan_id: str | None = Field(None, description="План; иначе последний")
    engineer_id: str = Field(..., description="Инженер, у которого появился промежуток")
    from_time: str = Field(..., description="Начало промежутка, HH:MM")
    to_time: str = Field(..., description="Конец промежутка, HH:MM")


class WhatIfRequest(BaseModel):
    """Песочница «что если» (S14)."""

    plan_id: str | None = Field(None, description="Базовый план; иначе последний")
    changes: list[dict] = Field(..., description="Список событий/изменений (как в /events/apply)")
    solver: Literal["hybrid_v2", "alns"] | None = None
    seed: int | None = None
    time_limit_seconds: float | None = Field(None, gt=0, le=300)


class ExtendResourceRequest(BaseModel):
    """Добор ресурса под неназначенные заявки (S13)."""

    plan_id: str | None = Field(None, description="Базовый план; иначе последний")
    order_ids: list[str] = Field(..., description="Заявки, которые пытаемся закрыть")
    option: Literal["extend_shift", "neighbor_region", "add_engineer"] = Field(
        "extend_shift",
        description="`extend_shift` — продлить смену; `neighbor_region`/`add_engineer` — добавить инженера",
    )
    params: dict = Field(
        default_factory=dict,
        description="Для extend_shift: `engineer_id`, `extend_min`; для neighbor_region: `engineer`",
    )
    apply: bool = Field(False, description="false — версия proposed; true — сразу applied")
    time_limit_seconds: float | None = Field(None, gt=0, le=300)


class CompareRequest(BaseModel):
    """Сравнение стратегий планирования (S0)."""

    scenario_id: str | None = Field(None, description="Сценарий; иначе последний загруженный")
    plan_id: str | None = Field(None, description="План; для стратегии incremental и dispatcher")
    strategies: list[Literal["ours", "fifo", "dispatcher", "incremental", "plan"]] = Field(
        default_factory=lambda: ["ours", "fifo", "dispatcher"],
        description="Какие стратегии сравнивать",
    )
    solver: Literal["hybrid_v2", "alns"] | None = None
    seed: int | None = None
    time_limit_seconds: float | None = Field(None, gt=0, le=300)

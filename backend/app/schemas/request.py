"""Схемы заявок (вход и выход)."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, field_validator, model_validator

from app.core.constants import (
    normalize_priority,
    normalize_skill,
    normalize_transport,
    skill_display,
    transport_display,
)
from app.schemas.validators import validate_time_string

_REQUEST_EXAMPLE = {
    "id": "R001",
    "latitude": 55.762,
    "longitude": 37.63,
    "address": "Москва, ул. Примерная, 1",
    "duration_minutes": 45,
    "window_start": "10:00",
    "window_end": "12:00",
    "priority": "normal",
    "required_skill": "installation",
    "required_transport": "car",
}


class RequestIn(BaseModel):
    """Заявка во входных данных.

    Координаты обязательны для корректной маршрутизации. Если переданы только
    ``address`` и разрешено демонстрационное геокодирование, координаты будут
    получены детерминированным образом (см. настройку ``ALLOW_DEMO_GEOCODING``).
    """

    id: str = Field(..., min_length=1, max_length=64, description="Уникальный идентификатор заявки", examples=["R001"])
    latitude: float | None = Field(
        None, ge=-90, le=90, description="Широта точки заявки (вместе с longitude)", examples=[55.762]
    )
    longitude: float | None = Field(
        None, ge=-180, le=180, description="Долгота точки заявки (вместе с latitude)", examples=[37.63]
    )
    address: str | None = Field(
        None, max_length=500, description="Адрес (для отображения на карте)", examples=["Москва, ул. Примерная, 1"]
    )
    duration_minutes: int = Field(
        ..., gt=0, le=1440, description="Длительность работ, минуты", examples=[45]
    )
    window_start: str = Field(
        ..., description="Начало временного окна визита, HH:MM", examples=["10:00"]
    )
    window_end: str = Field(
        ..., description="Конец временного окна визита, HH:MM", examples=["12:00"]
    )
    priority: str = Field(
        "normal", description="Приоритет: `normal`/«Обычная» или `urgent`/«Срочная»", examples=["normal"]
    )
    required_skill: str = Field(
        ...,
        description=(
            "Требуемый навык: `local`/«Локальные работы», `installation`/«Работы на "
            "подключение и дозаказы», `emergency`/«Аварийные работы»."
        ),
        examples=["installation"],
    )
    required_transport: str | None = Field(
        None,
        description=(
            "Требуемый транспорт (`car`/`walk`/`bike`/`public_transport`) или `null`, "
            "если ограничения нет."
        ),
        examples=["car", None],
    )
    equipment: dict[str, int] = Field(
        default_factory=dict,
        description=(
            "Требуемое оборудование (Max): вид → количество, например `{\"router\": 1}`. "
            "Проверяется наличие у инженера (комплект `kit`)."
        ),
        examples=[{"router": 1}],
    )
    min_skill_level: int = Field(
        1, ge=1, le=5, description="Минимальный уровень требуемого навыка (Max)."
    )
    assigned_engineer: str | None = Field(
        None,
        description=(
            "ID инженера из реального плана диспетчера. Используется только стратегией "
            "`dispatcher` в сравнении планов."
        ),
    )
    assigned_start: str | None = Field(
        None, description="Плановое начало работ из плана диспетчера, HH:MM (стратегия `dispatcher`)."
    )
    dispatcher_engineer_id: str | None = Field(
        None, description="Назначение реального диспетчера (колонка «Бригада»); алиас `assigned_engineer`."
    )
    external_id: str | None = Field(None, description="ID заявки во внешней системе (контрольный файл).")
    type_bk: str | None = Field(None, description="Тип заявки BK (Подключение / Дозаказ / Локальная заявка / Глобальная проблема).")
    type_hd: str | None = Field(None, description="Тип заявки HD («что делать» на карточке).")
    district: str | None = Field(None, description="Район.")
    gigabit: bool = Field(False, description="Гигабитное подключение.")
    technology: str | None = Field(None, description="Технология подключения: FMC / FTTB / null.")
    priority_rank: int = Field(1, ge=1, le=3, description="1 — Авария, 2 — Подключение, 3 — Локальная/Дозаказ.")
    source: str = Field("dispatcher", description="Источник заявки: csv/operator/dispatcher/helpdesk.")
    client_window_locked: bool = Field(False, description="Окно зафиксировано клиентом (сценарий B).")
    release_time: int = Field(0, ge=0, description="Время доступности заявки, минуты от начала суток.")

    model_config = {
        "json_schema_extra": {"example": _REQUEST_EXAMPLE},
        "extra": "forbid",
    }

    @field_validator("window_start", "window_end")
    @classmethod
    def _check_time(cls, value: str) -> str:
        return validate_time_string(value)

    @field_validator("required_skill")
    @classmethod
    def _normalize_skill(cls, value: str) -> str:
        normalized = normalize_skill(value)
        if not normalized:
            raise ValueError("required_skill не может быть пустым")
        return normalized

    @field_validator("required_transport")
    @classmethod
    def _normalize_transport(cls, value: str | None) -> str | None:
        if value is None or not str(value).strip():
            return None
        return normalize_transport(value)

    @field_validator("priority")
    @classmethod
    def _normalize_priority(cls, value: str) -> str:
        return normalize_priority(value)

    @model_validator(mode="after")
    def _check_window(self) -> "RequestIn":
        from app.schemas.validators import time_to_minutes

        if time_to_minutes(self.window_end) < time_to_minutes(self.window_start):
            raise ValueError("window_end не может быть раньше window_start")
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("Широта и долгота должны задаваться вместе")
        return self

    @property
    def has_coordinates(self) -> bool:
        """Есть ли у заявки явные координаты."""
        return self.latitude is not None and self.longitude is not None


class RequestOut(BaseModel):
    """Заявка в выходных данных с человекочитаемыми названиями."""

    id: str
    latitude: float
    longitude: float
    address: str | None = None
    duration_minutes: int
    window_start: str
    window_end: str
    priority: str
    required_skill: str
    required_skill_display: str
    required_transport: str | None = None
    required_transport_display: str | None = None
    equipment: dict[str, int] = Field(default_factory=dict)
    min_skill_level: int = 1
    assigned_engineer: str | None = None
    assigned_start: str | None = None
    dispatcher_engineer_id: str | None = None
    external_id: str | None = None
    type_bk: str | None = None
    type_hd: str | None = None
    district: str | None = None
    gigabit: bool = False
    technology: str | None = None
    priority_rank: int = 1
    source: str = "dispatcher"
    client_window_locked: bool = False
    status: str = Field("unassigned", description="Статус заявки (см. §4.4 ТЗ).")
    flags: list[str] = Field(default_factory=list, description="Флаги: urgent/at_risk/late/changed/started_early/reaction_late.")
    cancel_reason: str | None = Field(None, description="Причина отмены: client_refused|no_access|technical|other.")
    rescheduled_to: str | None = Field(None, description="Дата переноса YYYY-MM-DD.")

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "RequestOut":
        """Собирает ответ из нормализованного словаря заявки."""
        transport = raw.get("required_transport")
        return cls(
            id=raw["id"],
            latitude=raw.get("latitude") if raw.get("latitude") is not None else 0.0,
            longitude=raw.get("longitude") if raw.get("longitude") is not None else 0.0,
            address=raw.get("address"),
            duration_minutes=raw["duration_minutes"],
            window_start=raw["window_start"],
            window_end=raw["window_end"],
            priority=raw.get("priority", "normal"),
            required_skill=raw["required_skill"],
            required_skill_display=skill_display(raw["required_skill"]),
            required_transport=transport,
            required_transport_display=transport_display(transport) if transport else None,
            equipment=dict(raw.get("equipment", {})),
            min_skill_level=int(raw.get("min_skill_level", 1)),
            assigned_engineer=raw.get("assigned_engineer") or raw.get("dispatcher_engineer_id"),
            assigned_start=raw.get("assigned_start"),
            dispatcher_engineer_id=raw.get("dispatcher_engineer_id") or raw.get("assigned_engineer"),
            external_id=raw.get("external_id"),
            type_bk=raw.get("type_bk"),
            type_hd=raw.get("type_hd"),
            district=raw.get("district"),
            gigabit=bool(raw.get("gigabit", False)),
            technology=raw.get("technology"),
            priority_rank=int(raw.get("priority_rank", 1)),
            source=raw.get("source", "dispatcher"),
            client_window_locked=bool(raw.get("client_window_locked", False)),
            status=raw.get("status", "unassigned"),
            flags=list(raw.get("flags", [])),
            cancel_reason=raw.get("_cancel_reason") or raw.get("cancel_reason"),
            rescheduled_to=(raw.get("_rescheduled_to") or {}).get("date")
            if isinstance(raw.get("_rescheduled_to"), dict)
            else raw.get("rescheduled_to"),
        )

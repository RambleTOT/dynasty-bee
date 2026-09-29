"""Схемы инженеров (вход и выход)."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, field_validator

from app.core.constants import normalize_skill, normalize_transport, skill_display, transport_display
from app.schemas.validators import validate_time_string

_ENGINEER_EXAMPLE = {
    "id": "E01",
    "name": "Иван Петров",
    "latitude": 55.751244,
    "longitude": 37.618423,
    "shift_start": "09:00",
    "shift_end": "18:00",
    "skills": ["local", "installation"],
    "transport": "car",
    "available": True,
}


class EngineerIn(BaseModel):
    """Инженер во входных данных.

    skills — от 1 до 3 навыков из справочника кейса;
    transport — ровно один тип транспортного средства;
    available — можно ли назначать заявки (используется при перепланировании).
    """

    id: str = Field(
        ..., min_length=1, max_length=64, description="Уникальный идентификатор инженера", examples=["E01"]
    )
    name: str = Field(..., min_length=1, max_length=255, description="Имя инженера", examples=["Иван Петров"])
    latitude: float = Field(
        ..., ge=-90, le=90, description="Широта стартовой точки", examples=[55.751244]
    )
    longitude: float = Field(
        ..., ge=-180, le=180, description="Долгота стартовой точки", examples=[37.618423]
    )
    shift_start: str = Field(..., description="Начало смены, формат HH:MM", examples=["09:00"])
    shift_end: str = Field(..., description="Конец смены, формат HH:MM", examples=["18:00"])
    skills: list[str] = Field(
        ...,
        min_length=1,
        max_length=3,
        description=(
            "Навыки инженера (1–3). Значения: `local`/«Локальные работы», "
            "`installation`/«Работы на подключение и дозаказы», `emergency`/«Аварийные работы»."
        ),
        examples=[["local", "installation"]],
    )
    transport: str = Field(
        ...,
        description=(
            "Тип транспорта: `car`/«Автомобиль», `walk`/«Пешеход», `bike`/«Велосипед», "
            "`public_transport`/«Общественный транспорт»."
        ),
        examples=["car"],
    )
    available: bool = Field(
        True,
        description="Доступен ли инженер для назначения (используется при перепланировании)",
        examples=[True],
    )
    kit: dict[str, int] = Field(
        default_factory=dict,
        description=(
            "Комплект оборудования, выданный инженеру (Max): вид → количество. "
            "Например, `{\"router\": 2, \"ont\": 1}`. Для проверки ограничения "
            "«оборудование» важно наличие (количество > 0)."
        ),
        examples=[{"router": 2, "ont": 1}],
    )
    skill_levels: dict[str, int] = Field(
        default_factory=dict,
        description="Уровни владения навыками (необязательно), например `{\"emergency\": 3}`.",
        examples=[{"emergency": 3}],
    )
    start_kind: str = Field("office", description="Тип стартовой точки: office | home.")
    available_until: str | None = Field(None, description="Доступен до HH:MM (после «не могу работать»).")
    shift_status: str = Field("not_started", description="not_started | on_shift | unavailable | finished.")
    actual_transport: str | None = Field(None, description="Фактический транспорт с начала смены.")

    model_config = {
        "json_schema_extra": {"example": _ENGINEER_EXAMPLE},
        "extra": "forbid",
    }

    @field_validator("shift_start", "shift_end")
    @classmethod
    def _check_time(cls, value: str) -> str:
        return validate_time_string(value)

    @field_validator("skills")
    @classmethod
    def _normalize_skills(cls, value: list[str]) -> list[str]:
        normalized = [normalize_skill(item) for item in value if item and item.strip()]
        if not normalized:
            raise ValueError("Нужен хотя бы один навык")
        # Убираем дубликаты, сохраняя порядок.
        return list(dict.fromkeys(normalized))

    @field_validator("transport")
    @classmethod
    def _normalize_transport(cls, value: str) -> str:
        return normalize_transport(value)


class EngineerOut(BaseModel):
    """Инженер в выходных данных."""

    id: str
    name: str
    latitude: float
    longitude: float
    shift_start: str
    shift_end: str
    skills: list[str]
    skills_display: list[str] = Field(..., description="Названия навыков для интерфейса")
    transport: str
    transport_display: str
    available: bool
    kit: dict[str, int] = Field(default_factory=dict, description="Комплект оборудования инженера")
    skill_levels: dict[str, int] = Field(default_factory=dict, description="Уровни навыков")
    start_kind: str = "office"
    available_until: str | None = None
    shift_status: str = "not_started"
    actual_transport: str | None = None
    assigned_tasks: int = Field(0, description="Сколько заявок назначено")
    distance_km: float = Field(0.0, description="Пробег по маршруту")

    @classmethod
    def from_raw(cls, raw: dict[str, Any], **extra: Any) -> "EngineerOut":
        """Собирает ответ из нормализованного словаря входных данных."""
        return cls(
            id=raw["id"],
            name=raw["name"],
            latitude=raw["latitude"],
            longitude=raw["longitude"],
            shift_start=raw["shift_start"],
            shift_end=raw["shift_end"],
            skills=list(raw["skills"]),
            skills_display=[skill_display(s) for s in raw["skills"]],
            transport=raw["transport"],
            transport_display=transport_display(raw["transport"]),
            available=raw.get("available", True),
            kit=dict(raw.get("kit", {})),
            skill_levels=dict(raw.get("skill_levels", {})),
            start_kind=raw.get("start_kind", "office"),
            available_until=raw.get("available_until"),
            shift_status=raw.get("shift_status", "not_started"),
            actual_transport=raw.get("actual_transport"),
            **extra,
        )

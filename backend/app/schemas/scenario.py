"""Схемы сценариев (загрузка и просмотр входных данных)."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from app.schemas.engineer import EngineerIn, EngineerOut
from app.schemas.request import RequestIn, RequestOut

_SCENARIO_EXAMPLE = {
    "name": "Демонстрационный день",
    "description": "12 инженеров и 45 заявок",
    "engineers": [EngineerIn.model_config["json_schema_extra"]["example"]],
    "requests": [RequestIn.model_config["json_schema_extra"]["example"]],
}


class ScenarioIn(BaseModel):
    """Тело запроса на загрузку входных данных."""

    name: str = Field("Сценарий", max_length=255, description="Название сценария")
    description: str | None = Field(None, max_length=2000, description="Описание сценария")
    engineers: list[EngineerIn] = Field(..., min_length=1, description="Список инженеров")
    requests: list[RequestIn] = Field(..., min_length=1, description="Список заявок")
    scenario_metadata: dict[str, Any] = Field(
        default_factory=dict, description="Произвольные метаданные"
    )

    model_config = {"json_schema_extra": {"example": _SCENARIO_EXAMPLE}}


class ScenarioSummary(BaseModel):
    """Краткая информация о сохранённом сценарии."""

    scenario_id: str
    name: str
    description: str | None = None
    created_at: datetime
    engineer_count: int
    request_count: int
    skills: list[str] = Field(..., description="Использованные навыки")
    transports: list[str] = Field(..., description="Использованные типы транспорта")
    region_id: str | None = Field(None, description="Регион рабочего дня")
    date: str | None = Field(None, description="Дата рабочего дня YYYY-MM-DD")
    source: str | None = Field(None, description="Источник: csv | booking | demo | json")
    import_report: dict[str, Any] | None = Field(None, description="Отчёт импорта CSV (для /import-beeline)")


class ScenarioOut(BaseModel):
    """Полные входные данные сценария."""

    scenario_id: str
    name: str
    description: str | None = None
    created_at: datetime
    scenario_metadata: dict[str, Any] = Field(default_factory=dict)
    region_id: str | None = None
    date: str | None = None
    source: str | None = None
    office: dict[str, Any] | None = None
    active_plan_id: str | None = None
    draft_plan_id: str | None = None
    clock: str | None = None
    engineers: list[EngineerOut]
    requests: list[RequestOut]


class ScenarioListResponse(BaseModel):
    """Список сохранённых сценариев."""

    count: int
    items: list[ScenarioSummary]

"""Общие схемы ответов и ошибок."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class ErrorResponse(BaseModel):
    """Унифицированный ответ об ошибке."""

    detail: str = Field(..., description="Человекочитаемое описание ошибки")
    code: str | None = Field(None, description="Машинный код ошибки")
    context: dict[str, Any] | None = Field(None, description="Дополнительный контекст")


class HealthResponse(BaseModel):
    """Ответ проверки работоспособности сервиса."""

    status: str = Field(..., description="Статус сервиса", examples=["ok"])
    app_version: str = Field(..., description="Версия приложения")
    algorithm_available: bool = Field(
        ..., description="Доступен ли пакет алгоритма оптимизации"
    )
    database: str = Field(..., description="Тип используемого хранилища")


class MessageResponse(BaseModel):
    """Простое сообщение (например, результат удаления)."""

    message: str

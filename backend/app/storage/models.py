"""ORM-модели хранилища: сценарии, планы и события перепланирования."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import DateTime, Float, ForeignKey, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.storage.database import Base


def _uuid() -> str:
    """Генерирует строковый первичный ключ."""
    return str(uuid.uuid4())


def _now() -> datetime:
    """Текущее время в UTC (единый формат для всех записей)."""
    return datetime.now(timezone.utc)


class Scenario(Base):
    """Загруженный входной сценарий: инженеры и заявки."""

    __tablename__ = "scenarios"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(255), default="Сценарий")
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    engineers: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    requests: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    scenario_metadata: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Plan(Base):
    """Результат запуска алгоритма для конкретного сценария.

    ``kind`` различает оптимизированный план, базовый сценарий и результат
    перепланирования. ``input_payload`` хранит снимок входных данных на момент
    расчёта, чтобы перепланирование и объяснения не зависели от последующих
    изменений сценария.
    """

    __tablename__ = "plans"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    scenario_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("scenarios.id"), nullable=True, index=True
    )
    parent_plan_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("plans.id"), nullable=True, index=True
    )
    kind: Mapped[str] = mapped_column(String(32), default="optimized")
    status: Mapped[str] = mapped_column(String(32), default="completed")
    input_payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    result: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    metrics: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    algorithm_meta: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Event(Base):
    """Событие перепланирования (срочная заявка, отмена, недоступность инженера)."""

    __tablename__ = "events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    plan_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("plans.id"), index=True)
    scenario_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("scenarios.id"), index=True)
    event_type: Mapped[str] = mapped_column(String(64))
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    result_plan_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class EngineerAction(Base):
    """Нажатие инженера (факт дня): начал смену, в пути, выполнил и т.п."""

    __tablename__ = "engineer_actions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    engineer_id: Mapped[str] = mapped_column(String(64), index=True)
    scenario_id: Mapped[str | None] = mapped_column(String(36), index=True)
    request_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    action: Mapped[str] = mapped_column(String(32))
    at: Mapped[str | None] = mapped_column(String(8), nullable=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    result_event_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class User(Base):
    """Пользователь системы (диспетчер / оператор / инженер)."""

    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    login: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    name: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(32))  # dispatcher | operator | engineer
    region_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    engineer_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class GeocodeCache(Base):
    """Кэш геокодера: адрес → координаты (п. 15)."""

    __tablename__ = "geocode_cache"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    address: Mapped[str] = mapped_column(String(512), unique=True, index=True)
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    provider: Mapped[str] = mapped_column(String(32), default="yandex")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class RegionRecord(Base):
    """Свой участок (§14): офис, нормативы и ростер. Участки кейса — в коде (core/regions.py)."""

    __tablename__ = "regions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(60))
    name_key: Mapped[str] = mapped_column(String(60), unique=True, index=True)
    office_address: Mapped[str] = mapped_column(String(255))
    office_lat: Mapped[float] = mapped_column(Float)
    office_lon: Mapped[float] = mapped_column(Float)
    norms: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    roster: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    request_count: Mapped[int] = mapped_column(default=0)
    has_control: Mapped[bool] = mapped_column(default=False)
    created_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

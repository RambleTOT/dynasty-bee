"""Дополнительные схемы: регионы, diff, booking, день инженера."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


# --- Регионы ----------------------------------------------------------------
class OfficeOut(BaseModel):
    address: str
    lat: float
    lon: float


class UserOut(BaseModel):
    """Профиль пользователя системы."""

    id: str
    login: str
    name: str
    role: str = Field(..., description="dispatcher | operator | engineer")
    region_ids: list[str] = Field(default_factory=list)
    engineer_id: str | None = None


class RegionNormType(BaseModel):
    """Норматив: тип заявки BK → навык и длительность работ без дороги (§14)."""

    type_bk: str = Field(..., min_length=1, max_length=100)
    skill: str = Field(..., description="local | installation | emergency (или русское название)")
    duration_minutes: int = Field(..., ge=5, le=480)


class RegionNorms(BaseModel):
    types: list[RegionNormType] = Field(default_factory=list, max_length=200)


class OfficeIn(BaseModel):
    address: str = Field(..., min_length=1, max_length=255)
    lat: float = Field(..., ge=-90, le=90)
    lon: float = Field(..., ge=-180, le=180)


class RegionCreate(BaseModel):
    """Новый участок (§14)."""

    name: str = Field(..., min_length=1, max_length=60)
    office: OfficeIn
    norms: RegionNorms | None = None


class RegionPatch(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=60)
    office: OfficeIn | None = None
    norms: RegionNorms | None = None


class RegionOut(BaseModel):
    region_id: str
    name: str
    office: OfficeOut
    request_count: int
    engineer_count: int
    demo_available: bool
    has_control: bool
    builtin: bool = True
    norms: RegionNorms | None = None
    created_at: str | None = None


# --- Diff -------------------------------------------------------------------
class DiffSummary(BaseModel):
    reassigned: int = 0
    reordered: int = 0
    time_shifted: int = 0
    added: int = 0
    removed: int = 0
    newly_unassigned: int = 0
    newly_assigned: int = 0
    untouched: int = 0


class EngineerDiff(BaseModel):
    engineer_id: str
    km_before: float = 0.0
    km_after: float = 0.0
    route_changed: bool = False


class PlanDiffResponse(BaseModel):
    base_plan_id: str
    new_plan_id: str
    summary: DiffSummary
    changes: list[dict[str, Any]] = Field(default_factory=list)
    engineers: list[EngineerDiff] = Field(default_factory=list)
    metrics_before: dict[str, Any] = Field(default_factory=dict)
    metrics_after: dict[str, Any] = Field(default_factory=dict)
    headline: str = ""


# --- Booking ----------------------------------------------------------------
class SlotOut(BaseModel):
    window: str
    available: bool
    reason_code: str | None = None
    reason: str | None = None


class BookingSlotsResponse(BaseModel):
    region_id: str
    date: str
    required_skill: str
    duration_minutes: int
    required_transport: str | None = None
    district: str | None = None
    slots: list[SlotOut] = Field(default_factory=list)


class BookingRequestIn(BaseModel):
    region_id: str
    date: str
    window: str
    type_bk: str
    type_hd: str | None = None
    address: str
    district: str | None = None
    gigabit: bool = False
    technology: str | None = None
    required_transport: str | None = None
    client_contact: str | None = None


class BookingRequestOut(BaseModel):
    request_id: str
    scenario_id: str
    status: str
    tentative_engineer_id: str | None = None
    engineer_id: str | None = None
    plan_id: str | None = None
    window: str
    message: str | None = None


class BookingCancelIn(BaseModel):
    reason: Literal["client_refused", "booking_error", "other"] = "client_refused"
    comment: str | None = None


class BookingRescheduleIn(BaseModel):
    new_date: str
    new_window: str


class CallbackItem(BaseModel):
    request_id: str
    client_contact: str | None = None
    old_window: str
    new_window: str | None = None
    status: str
    reason: str | None = None


# --- Инженер ----------------------------------------------------------------
class EngineerVisit(BaseModel):
    request_id: str
    sequence: int
    status: str
    flags: list[str] = Field(default_factory=list)
    type_bk: str | None = None
    type_hd: str | None = None
    address: str | None = None
    district: str | None = None
    window: str
    arrival: str | None = None
    start: str | None = None
    actual_start: str | None = None
    actual_end: str | None = None
    duration_minutes: int
    leg_km: float = 0.0
    gigabit: bool = False
    technology: str | None = None
    equipment: dict[str, int] = Field(default_factory=dict)
    why_you: str = ""


class EngineerDayResponse(BaseModel):
    engineer: dict[str, Any]
    summary: dict[str, Any]
    active_request_id: str | None = None
    visits: list[EngineerVisit] = Field(default_factory=list)
    banners: list[dict[str, Any]] = Field(default_factory=list)


class EngineerActionIn(BaseModel):
    action: str = Field(..., description="shift_start|en_route|start|complete|fail|delay|unavailable|shift_end")
    request_id: str | None = None
    at: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


class EngineerActionOut(BaseModel):
    engineer_id: str
    action: str
    status: str
    event_id: str | None = None
    request_id: str | None = None
    day: EngineerDayResponse | None = None

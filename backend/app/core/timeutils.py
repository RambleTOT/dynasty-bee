"""Реальное время по часовому поясу (D-19)."""
from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from app.core.config import get_settings


def tzinfo() -> ZoneInfo:
    """Часовой пояс сервиса (например, Europe/Moscow)."""
    try:
        return ZoneInfo(get_settings().timezone)
    except Exception:  # noqa: BLE001
        return ZoneInfo("UTC")


def now() -> datetime:
    """Текущее время в часовом поясе сервиса."""
    return datetime.now(tzinfo())


def now_hhmm() -> str:
    """Текущее время ``HH:MM`` в часовом поясе сервиса."""
    return now().strftime("%H:%M")


def today_str() -> str:
    """Сегодняшняя дата ``YYYY-MM-DD`` в часовом поясе сервиса."""
    return now().strftime("%Y-%m-%d")

"""Валидаторы и утилиты для схем API."""
from __future__ import annotations

import re

_TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def validate_time_string(value: str) -> str:
    """Проверяет строку времени формата ``HH:MM`` (00:00–23:59)."""
    if not isinstance(value, str) or not _TIME_RE.match(value.strip()):
        raise ValueError(f"Время должно быть в формате HH:MM, получено: {value!r}")
    return value.strip()


def time_to_minutes(value: str) -> int:
    """Переводит ``HH:MM`` в минуты от начала суток."""
    validate_time_string(value)
    hours, minutes = value.split(":")
    return int(hours) * 60 + int(minutes)


def safe_time_to_minutes(value: str) -> int:
    """Переводит ``HH:MM`` в минуты, допуская часы ≥ 24 (вычисленные времена).

    Нужен для планов с ручным override, где работа может формально выйти за
    полночь (``24:57``).
    """
    try:
        hours, minutes = value.split(":")
        return int(hours) * 60 + int(minutes)
    except (ValueError, AttributeError) as exc:
        raise ValueError(f"Некорректное время: {value!r}") from exc


def minutes_to_time(value: int) -> str:
    """Переводит минуты от начала суток в ``HH:MM``."""
    value = int(round(value))
    return f"{value // 60:02d}:{value % 60:02d}"

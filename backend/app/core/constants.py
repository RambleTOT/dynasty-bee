"""Справочники предметной области и функции нормализации.

Кейс фиксирует закрытые справочники навыков, типов транспорта и приоритетов.
Внешний API может присылать как русские названия из кейса, так и короткие
английские ключи. Здесь они приводятся к единым каноническим ключам, которые
используются внутри алгоритма и хранятся в БД.
"""
from __future__ import annotations

import math

# --- Навыки -----------------------------------------------------------------
# Канонические ключи навыков.
SKILL_LOCAL = "local"
SKILL_INSTALLATION = "installation"
SKILL_EMERGENCY = "emergency"

SKILL_ALIASES: dict[str, str] = {
    "local": SKILL_LOCAL,
    "локальные работы": SKILL_LOCAL,
    "локальные": SKILL_LOCAL,
    "installation": SKILL_INSTALLATION,
    "работы на подключение и дозаказы": SKILL_INSTALLATION,
    "работы на подключение": SKILL_INSTALLATION,
    "подключение": SKILL_INSTALLATION,
    "дозаказы": SKILL_INSTALLATION,
    "emergency": SKILL_EMERGENCY,
    "аварийные работы": SKILL_EMERGENCY,
    "аварийные": SKILL_EMERGENCY,
}

# Человекочитаемые названия для объяснений и интерфейса.
SKILL_DISPLAY: dict[str, str] = {
    SKILL_LOCAL: "Локальные работы",
    SKILL_INSTALLATION: "Работы на подключение и дозаказы",
    SKILL_EMERGENCY: "Аварийные работы",
}

# --- Транспорт --------------------------------------------------------------
TRANSPORT_CAR = "car"
TRANSPORT_WALK = "walk"
TRANSPORT_BIKE = "bike"
TRANSPORT_PUBLIC = "public_transport"

TRANSPORT_ALIASES: dict[str, str] = {
    "car": TRANSPORT_CAR,
    "автомобиль": TRANSPORT_CAR,
    "машина": TRANSPORT_CAR,
    "авто": TRANSPORT_CAR,
    "walk": TRANSPORT_WALK,
    "пешеход": TRANSPORT_WALK,
    "пешком": TRANSPORT_WALK,
    "bike": TRANSPORT_BIKE,
    "велосипед": TRANSPORT_BIKE,
    "public_transport": TRANSPORT_PUBLIC,
    "общественный транспорт": TRANSPORT_PUBLIC,
    "общественный": TRANSPORT_PUBLIC,
}

#: Правило D-06 в редакции D-40 (29.09): «Тип заявки HD», которому нужен автомобиль, если
#: требуемый транспорт не задан явно. «Гигабитное подключение = Да» из правила убрано: в новых
#: днях это треть потока, норматив Билайна машину для гигабита не требует; гигабит — атрибут заявки.
CAR_RULE_HD: tuple[str, ...] = ("Работа с кабелем", "Авария")


def car_by_rule(type_hd: str | None) -> bool:
    """Нужен ли автомобиль по правилу D-06 (D-40)."""
    key = (type_hd or "").strip().lower()
    return any(key == name.lower() for name in CAR_RULE_HD)


TRANSPORT_DISPLAY: dict[str, str] = {
    TRANSPORT_CAR: "Автомобиль",
    TRANSPORT_WALK: "Пешеход",
    TRANSPORT_BIKE: "Велосипед",
    TRANSPORT_PUBLIC: "Общественный транспорт",
}

# Средние скорости (км/ч) для упрощённого расчёта времени в пути.
TRANSPORT_SPEED_KMH: dict[str, float] = {
    TRANSPORT_CAR: 30.0,
    TRANSPORT_WALK: 5.0,
    TRANSPORT_BIKE: 14.0,
    TRANSPORT_PUBLIC: 19.0,
}

# Для общественного транспорта добавляется фиксированное время ожидания/пересадки.
PUBLIC_TRANSPORT_PENALTY_MINUTES = 5

# --- Общественный транспорт: эвристика времени (визуальная симуляция) -------
# Настоящего расписания автобусов нет, поэтому время считаем по расстоянию.
# До 15 км — городской транспорт (18 км/ч + 10 мин ожидания), свыше — электричка
# (35 км/ч + 15 мин). Геометрия при этом берётся автомобильная (дороги OSM).
PUBLIC_TRANSPORT_SHORT_SPEED_KMH = 18.0
PUBLIC_TRANSPORT_SHORT_WAIT_MIN = 10
PUBLIC_TRANSPORT_LONG_SPEED_KMH = 35.0
PUBLIC_TRANSPORT_LONG_WAIT_MIN = 15
PUBLIC_TRANSPORT_LONG_THRESHOLD_KM = 15.0


def public_transport_minutes(distance_km: float) -> int:
    """Время в пути общественным транспортом (минуты, округление вверх).

    До 15 км — ``км / 18 км/ч * 60 + 10``; свыше — ``км / 35 км/ч * 60 + 15``.
    """
    if distance_km <= 0:
        return 0
    if distance_km <= PUBLIC_TRANSPORT_LONG_THRESHOLD_KM:
        return math.ceil(
            distance_km / PUBLIC_TRANSPORT_SHORT_SPEED_KMH * 60.0
            + PUBLIC_TRANSPORT_SHORT_WAIT_MIN
        )
    return math.ceil(
        distance_km / PUBLIC_TRANSPORT_LONG_SPEED_KMH * 60.0
        + PUBLIC_TRANSPORT_LONG_WAIT_MIN
    )


# --- Математика для не-авто транспорта (Enterprise: OSRM только car) --------
#: Дорожный коэффициент для оценки не-авто транспорта.
MATH_ROAD_FACTOR = 1.3
#: Скорости (км/ч) для математического расчёта.
MATH_SPEED_KMH: dict[str, float] = {
    TRANSPORT_WALK: 4.5,
    TRANSPORT_BIKE: 14.0,
}


def math_travel_minutes(distance_km: float, transport: str) -> int:
    """Время в пути по математической модели (минуты, округление вверх)."""
    if distance_km <= 0:
        return 0
    if transport == TRANSPORT_PUBLIC:
        return public_transport_minutes(distance_km)
    speed = MATH_SPEED_KMH.get(transport, TRANSPORT_SPEED_KMH[TRANSPORT_CAR])
    return math.ceil(distance_km / speed * 60.0)

# --- Приоритеты -------------------------------------------------------------
PRIORITY_NORMAL = "normal"
PRIORITY_URGENT = "urgent"

PRIORITY_ALIASES: dict[str, str] = {
    "normal": PRIORITY_NORMAL,
    "обычная": PRIORITY_NORMAL,
    "обычный": PRIORITY_NORMAL,
    "urgent": PRIORITY_URGENT,
    "срочная": PRIORITY_URGENT,
    "срочный": PRIORITY_URGENT,
}

PRIORITY_DISPLAY: dict[str, str] = {
    PRIORITY_NORMAL: "Обычная",
    PRIORITY_URGENT: "Срочная",
}

# --- События перепланирования ----------------------------------------------
EVENT_URGENT_REQUEST = "urgent_request"
EVENT_ENGINEER_UNAVAILABLE = "engineer_unavailable"
EVENT_REQUEST_CANCELLED = "request_cancelled"


def normalize_skill(value: str) -> str:
    """Приводит название навыка к каноническому ключу.

    Неизвестные навыки допускаются: алгоритм работает с произвольными
    строковыми идентификаторами навыков, а матрицы от навыка не зависят.
    """
    key = (value or "").strip().lower()
    return SKILL_ALIASES.get(key, key)


def normalize_transport(value: str) -> str:
    """Приводит тип транспорта к каноническому ключу.

    Неизвестный транспорт недопустим: для него нельзя корректно рассчитать
    скорость и время в пути.
    """
    key = (value or "").strip().lower()
    if key not in TRANSPORT_ALIASES:
        allowed = ", ".join(sorted(TRANSPORT_ALIASES))
        raise ValueError(f"Неизвестный тип транспорта: {value!r}. Допустимо: {allowed}")
    return TRANSPORT_ALIASES[key]


def normalize_priority(value: str | None) -> str:
    """Приводит приоритет заявки к каноническому значению."""
    key = (value or PRIORITY_NORMAL).strip().lower()
    if key not in PRIORITY_ALIASES:
        raise ValueError(f"Неизвестный приоритет: {value!r}")
    return PRIORITY_ALIASES[key]


def skill_display(value: str) -> str:
    """Возвращает человекочитаемое название навыка для объяснений."""
    canonical = normalize_skill(value)
    return SKILL_DISPLAY.get(canonical, value)


def transport_display(value: str) -> str:
    """Возвращает человекочитаемое название транспорта для объяснений."""
    try:
        canonical = normalize_transport(value)
    except ValueError:
        return value
    return TRANSPORT_DISPLAY.get(canonical, value)

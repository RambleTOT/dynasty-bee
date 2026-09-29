"""Детерминированная генерация демонстрационного набора по региону.

Воспроизводит структуру выданных CSV Билайна (типы заявок BK/HD, нормативы
длительности, правило требуемого транспорта, назначения диспетчера), но с
синтетическими координатами вокруг офиса региона.
"""
from __future__ import annotations

import random
import zlib

from app.core.constants import (
    SKILL_EMERGENCY,
    SKILL_INSTALLATION,
    SKILL_LOCAL,
    TRANSPORT_BIKE,
    TRANSPORT_CAR,
    TRANSPORT_PUBLIC,
    TRANSPORT_WALK,
)
from app.core.regions import REGIONS

DEFAULT_DATE = "2026-08-17"
SHIFT_START = "10:00"
SHIFT_END = "22:00"

#: Тип заявки BK/HD и норматив длительности по навыку.
_SKILL_WORK = {
    SKILL_EMERGENCY: ("Глобальная проблема", "Авария", 80),
    SKILL_INSTALLATION: ("Подключение", "Конвергенция абонента", 70),
    SKILL_LOCAL: ("Локальная заявка", "Ремонт", 30),
}

_DISTRICTS = ["Даниловский", "Текстильщики", "Бирюлёво", "Чертаново", "Марьино", "Люблино"]


def _window(rng: random.Random) -> tuple[str, str]:
    """Случайное двухчасовое окно из 6 слотов 10:00–22:00."""
    start_hour = 10 + 2 * rng.randint(0, 5)
    return f"{start_hour:02d}:00", f"{start_hour + 2:02d}:00"


def build_region_scenario(region_id: str, date: str = DEFAULT_DATE) -> dict:
    """Строит синтетический рабочий день региона с заданным числом заявок."""
    region = REGIONS.get(region_id) or REGIONS["east"]
    # zlib.crc32, а не hash(): hash() строк свой в каждом запуске Python (PYTHONHASHSEED),
    # и после перезапуска бэка у участков кейса менялись навыки бригад и демо-день
    rng = random.Random(zlib.crc32(f"{region_id}|{date}".encode("utf-8")))
    n_engineers = region["engineer_count"]
    n_requests = region["request_count"]
    lat0, lon0 = region["office"]["lat"], region["office"]["lon"]

    engineer_ids = [f"E{index:02d}" for index in range(1, n_engineers + 1)]
    transports = [TRANSPORT_CAR, TRANSPORT_WALK, TRANSPORT_BIKE, TRANSPORT_PUBLIC, TRANSPORT_CAR]
    engineers: list[dict] = []
    for index, engineer_id in enumerate(engineer_ids):
        skills = rng.sample(
            [SKILL_LOCAL, SKILL_INSTALLATION, SKILL_EMERGENCY], rng.randint(1, 3)
        )
        engineers.append(
            {
                "id": engineer_id,
                "name": f"Бригада {index + 1}",
                # Маршруты стартуют ровно из офиса участка (п. 41).
                "latitude": lat0,
                "longitude": lon0,
                "shift_start": SHIFT_START,
                "shift_end": SHIFT_END,
                "skills": skills,
                "transport": transports[index % len(transports)],
                "available": True,
                "start_kind": "office",
            }
        )

    car_target = region["car_requests"]
    requests: list[dict] = []
    for index in range(n_requests):
        skill = rng.choice([SKILL_LOCAL, SKILL_INSTALLATION, SKILL_EMERGENCY])
        type_bk, type_hd, duration = _SKILL_WORK[skill]
        window_start, window_end = _window(rng)
        gigabit = rng.random() < 0.2
        required_transport = None
        if skill == SKILL_EMERGENCY or type_hd == "Работа с кабелем" or gigabit:
            required_transport = TRANSPORT_CAR
        # Дозируем число автомобильных заявок под целевое значение региона.
        car_used = sum(1 for item in requests if item.get("required_transport") == TRANSPORT_CAR)
        if required_transport == TRANSPORT_CAR and car_used >= car_target:
            required_transport = None
        dispatcher = engineer_ids[rng.randrange(len(engineer_ids))] if rng.random() < 0.95 else None
        requests.append(
            {
                "id": f"{10000 + index * 7 + 1}",
                "latitude": round(lat0 + rng.uniform(-0.08, 0.08), 6),
                "longitude": round(lon0 + rng.uniform(-0.12, 0.12), 6),
                "address": f"г. Москва, ул. Примерная, д. {index + 1}",
                "district": rng.choice(_DISTRICTS),
                "type_bk": type_bk,
                "type_hd": type_hd,
                "gigabit": gigabit,
                "technology": rng.choice(["FMC", "FTTB", None]),
                "duration_minutes": duration,
                "window_start": window_start,
                "window_end": window_end,
                "priority": "urgent" if skill == SKILL_EMERGENCY and rng.random() < 0.3 else "normal",
                "priority_rank": 1 if skill == SKILL_EMERGENCY else (2 if skill == SKILL_INSTALLATION else 3),
                "required_skill": skill,
                "required_transport": required_transport,
                "release_time": 0,
                "source": "csv",
                "dispatcher_engineer_id": dispatcher,
            }
        )

    return {
        "name": f"{region['name']} · {date} · демо",
        "description": f"Синтетический день региона {region['name']} ({n_engineers} инженеров, {n_requests} заявок)",
        "engineers": engineers,
        "requests": requests,
        "scenario_metadata": {
            "region_id": region_id,
            "date": date,
            "source": "demo",
            "office": region["office"],
        },
    }

"""Генератор встроенного демонстрационного набора данных.

Скрипт создаёт детерминированный (seed фиксирован) синтетический сценарий
рабочего дня: список инженеров и список заявок вокруг Москвы в формате,
который принимает ``POST /api/v1/data/load``.

Набор специально содержит:
* все три навыка из справочника кейса;
* разные комбинации навыков у инженеров (от 1 до 3);
* все четыре типа транспорта;
* пересекающиеся временные окна;
* конфликты, при которых простое последовательное распределение
  (базовый сценарий) даёт заведомо худший план, чем оптимизатор.

Координаты синтетические и не являются реальными адресами.

Запуск:
    python backend/scripts/generate_demo_dataset.py
"""
from __future__ import annotations

import json
import random
from pathlib import Path

OUTPUT = Path(__file__).resolve().parents[1] / "app" / "data" / "demo_scenario.json"

SKILLS = ["local", "installation", "emergency"]
TRANSPORTS = ["car", "walk", "bike", "public_transport"]

ENGINEER_NAMES = [
    "Иван Петров",
    "Мария Соколова",
    "Алексей Кузнецов",
    "Ольга Смирнова",
    "Дмитрий Волков",
    "Екатерина Морозова",
    "Сергей Новиков",
    "Анна Фёдорова",
    "Павел Егоров",
    "Татьяна Павлова",
    "Никита Козлов",
    "Юлия Орлова",
]


def _coord(rng: random.Random, base_lat: float, base_lon: float, spread: float) -> tuple[float, float]:
    """Небольшое смещение вокруг базовой точки (в градусах)."""
    return round(base_lat + rng.uniform(-spread, spread), 6), round(
        base_lon + rng.uniform(-spread, spread), 6
    )


def build_engineers(rng: random.Random) -> list[dict]:
    """Формирует 12 инженеров с разными навыками, графиками и транспортом."""
    engineers: list[dict] = []
    for index, name in enumerate(ENGINEER_NAMES):
        # Каждый четвёртый инженер — универсал с тремя навыками,
        # остальные имеют комбинацию из одного-двух навыков.
        if index % 4 == 0:
            skills = list(SKILLS)
        elif index % 3 == 1:
            skills = ["installation", "emergency"]
        elif index % 3 == 2:
            skills = ["local", "installation"]
        else:
            skills = ["local"]
        transport = TRANSPORTS[index % len(TRANSPORTS)]
        # Часть сотрудников начинает смену раньше, часть позже.
        shift_start = rng.choice(["08:00", "08:30", "09:00", "09:30"])
        shift_end = rng.choice(["17:30", "18:00", "18:30", "19:00", "20:00"])
        lat, lon = _coord(rng, 55.75, 37.62, 0.09)
        engineers.append(
            {
                "id": f"E{index:02d}",
                "name": name,
                "latitude": lat,
                "longitude": lon,
                "shift_start": shift_start,
                "shift_end": shift_end,
                "skills": skills,
                "transport": transport,
                "available": True,
            }
        )
    return engineers


def build_requests(rng: random.Random, count: int = 45) -> list[dict]:
    """Формирует список заявок с окнами, приоритетами и требованиями."""
    requests: list[dict] = []
    windows = [
        ("09:00", "11:00"),
        ("10:00", "12:00"),
        ("11:00", "13:00"),
        ("12:00", "14:00"),
        ("13:00", "15:00"),
        ("14:00", "16:00"),
        ("15:00", "17:00"),
        ("16:00", "18:00"),
    ]
    for index in range(count):
        skill = SKILLS[index % len(SKILLS)]
        # Примерно у четверти заявок есть требование по транспорту.
        required_transport = None
        if index % 4 == 0:
            required_transport = "car"
        elif index % 7 == 0:
            required_transport = "public_transport"
        window_start, window_end = windows[index % len(windows)]
        lat, lon = _coord(rng, 55.75, 37.62, 0.12)
        requests.append(
            {
                "id": f"R{index:03d}",
                "latitude": lat,
                "longitude": lon,
                "address": f"Синтетический адрес, Москва, район {index % 10}",
                "duration_minutes": rng.choice([20, 30, 45, 60, 90]),
                "window_start": window_start,
                "window_end": window_end,
                "priority": "normal",
                "required_skill": skill,
                "required_transport": required_transport,
            }
        )
    # Пара заранее срочных заявок, чтобы в плане были разные приоритеты.
    requests[5]["priority"] = "urgent"
    requests[23]["priority"] = "urgent"
    return requests


def main() -> None:
    rng = random.Random(20260917)
    scenario = {
        "name": "Демонстрационный рабочий день (Москва)",
        "description": (
            "Синтетический набор из 12 инженеров и 45 заявок. "
            "Создан для демонстрации MVP: все навыки, все типы транспорта, "
            "пересекающиеся окна и конфликты распределения."
        ),
        "metadata": {
            "synthetic": True,
            "seed": 20260917,
            "assumption": "Координаты синтетические, дорожный коэффициент и скорости — упрощённые.",
        },
        "engineers": build_engineers(rng),
        "requests": build_requests(rng),
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(scenario, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Записано: {OUTPUT}")
    print(f"Инженеров: {len(scenario['engineers'])}, заявок: {len(scenario['requests'])}")


if __name__ == "__main__":
    main()

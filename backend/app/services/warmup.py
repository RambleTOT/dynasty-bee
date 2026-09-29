"""Прогрев вычислительного ядра алгоритма при старте сервиса.

Первое обращение к решателю запускает JIT-компиляцию Numba и может занимать
десятки секунд. Чтобы первый реальный запрос диспетчера отвечал быстро, при
старте выполняется короткий прогон на микро-задаче.
"""
from __future__ import annotations

import logging

from app.core.config import get_settings
from app.services.algorithm_adapter import AlgorithmAdapter, AlgorithmError

logger = logging.getLogger(__name__)

_WARMUP_ENGINEERS = [
    {
        "id": "W1",
        "name": "Прогрев 1",
        "latitude": 55.75,
        "longitude": 37.62,
        "shift_start": "09:00",
        "shift_end": "18:00",
        "skills": ["local", "installation", "emergency"],
        "transport": "car",
    },
    {
        "id": "W2",
        "name": "Прогрев 2",
        "latitude": 55.78,
        "longitude": 37.66,
        "shift_start": "09:00",
        "shift_end": "18:00",
        "skills": ["local", "emergency"],
        "transport": "bike",
    },
]

_WARMUP_REQUESTS = [
    {
        "id": "WT1",
        "latitude": 55.76,
        "longitude": 37.63,
        "duration_minutes": 30,
        "window_start": "10:00",
        "window_end": "12:00",
        "priority": "normal",
        "required_skill": "local",
    },
    {
        "id": "WT2",
        "latitude": 55.77,
        "longitude": 37.65,
        "duration_minutes": 30,
        "window_start": "11:00",
        "window_end": "13:00",
        "priority": "normal",
        "required_skill": "emergency",
    },
    {
        "id": "WT3",
        "latitude": 55.79,
        "longitude": 37.67,
        "duration_minutes": 20,
        "window_start": "12:00",
        "window_end": "14:00",
        "priority": "urgent",
        "required_skill": "installation",
        "required_transport": "bike",
    },
]


def warm_up_algorithm() -> bool:
    """Прогревает алгоритм на микро-задаче. Возвращает успех."""
    settings = get_settings()
    adapter = AlgorithmAdapter(
        settings.algorithm_dir, settings.road_factor, settings.allow_demo_geocoding
    )
    try:
        problem = adapter.prepare_problem(_WARMUP_ENGINEERS, _WARMUP_REQUESTS)
        adapter.run(problem, solver="alns", seed=0, total_seconds=1.0)
        logger.info("Алгоритм прогрет: JIT-компиляция завершена")
        return True
    except AlgorithmError as exc:
        logger.warning("Прогрев алгоритма не удался: %s", exc)
        return False

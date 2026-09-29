"""Общие фикстуры тестов: тестовая БД, клиент и подготовленный план."""
from __future__ import annotations

import os
import sys
from pathlib import Path

# Каталог backend добавляем в path, а БД переводим в память до импорта приложения.
BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))
os.environ.setdefault("DATABASE_URL", "sqlite://")
# Тесты не должны ходить во внешние/локальные маршрутизаторы.
os.environ["ORS_API_KEY"] = ""
os.environ["OSRM_LOCAL_ENABLED"] = "false"
os.environ["ALGORITHM_WARMUP"] = "false"
# В тестах авторизация отключена.
os.environ["AUTH_ENABLED"] = "false"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app.main import app  # noqa: E402
from app.storage import models  # noqa: E402,F401  (регистрация моделей)
from app.storage.database import Base, get_db  # noqa: E402

# Небольшой сценарий: все навыки, все типы транспорта, пересекающиеся окна.
SMALL_SCENARIO = {
    "name": "Тестовый день",
    "description": "4 инженера и 8 заявок",
    "engineers": [
        {
            "id": "E1",
            "name": "Инженер Один",
            "latitude": 55.75,
            "longitude": 37.62,
            "shift_start": "09:00",
            "shift_end": "18:00",
            "skills": ["local", "installation", "emergency"],
            "transport": "car",
        },
        {
            "id": "E2",
            "name": "Инженер Два",
            "latitude": 55.77,
            "longitude": 37.65,
            "shift_start": "09:00",
            "shift_end": "18:00",
            "skills": ["local", "installation"],
            "transport": "bike",
        },
        {
            "id": "E3",
            "name": "Инженер Три",
            "latitude": 55.74,
            "longitude": 37.60,
            "shift_start": "09:00",
            "shift_end": "18:00",
            "skills": ["emergency"],
            "transport": "walk",
        },
        {
            "id": "E4",
            "name": "Инженер Четыре",
            "latitude": 55.79,
            "longitude": 37.68,
            "shift_start": "09:00",
            "shift_end": "18:00",
            "skills": ["installation", "emergency"],
            "transport": "public_transport",
        },
    ],
    "requests": [
        {
            "id": "R1",
            "latitude": 55.76,
            "longitude": 37.63,
            "duration_minutes": 30,
            "window_start": "10:00",
            "window_end": "12:00",
            "priority": "normal",
            "required_skill": "installation",
        },
        {
            "id": "R2",
            "latitude": 55.78,
            "longitude": 37.66,
            "duration_minutes": 45,
            "window_start": "10:00",
            "window_end": "12:00",
            "priority": "normal",
            "required_skill": "local",
        },
        {
            "id": "R3",
            "latitude": 55.73,
            "longitude": 37.59,
            "duration_minutes": 30,
            "window_start": "11:00",
            "window_end": "13:00",
            "priority": "normal",
            "required_skill": "emergency",
        },
        {
            "id": "R4",
            "latitude": 55.80,
            "longitude": 37.69,
            "duration_minutes": 60,
            "window_start": "12:00",
            "window_end": "15:00",
            "priority": "normal",
            "required_skill": "installation",
            "required_transport": "car",
        },
        {
            "id": "R5",
            "latitude": 55.75,
            "longitude": 37.61,
            "duration_minutes": 20,
            "window_start": "13:00",
            "window_end": "15:00",
            "priority": "urgent",
            "required_skill": "emergency",
        },
        {
            "id": "R6",
            "latitude": 55.77,
            "longitude": 37.70,
            "duration_minutes": 30,
            "window_start": "14:00",
            "window_end": "16:00",
            "priority": "normal",
            "required_skill": "local",
        },
        {
            "id": "R7",
            "latitude": 55.72,
            "longitude": 37.64,
            "duration_minutes": 45,
            "window_start": "09:30",
            "window_end": "11:30",
            "priority": "normal",
            "required_skill": "installation",
        },
        {
            "id": "R8",
            "latitude": 55.79,
            "longitude": 37.62,
            "duration_minutes": 30,
            "window_start": "15:00",
            "window_end": "17:00",
            "priority": "normal",
            "required_skill": "emergency",
        },
    ],
}


def _create_test_engine():
    """Создаёт изолированный SQLite-движок в памяти для тестов."""
    return create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )


test_engine = _create_test_engine()
TestingSessionLocal = sessionmaker(bind=test_engine, autoflush=False, expire_on_commit=False)
Base.metadata.create_all(bind=test_engine)


def _override_get_db():
    """Подменяет зависимость БД на тестовую сессию."""
    session = TestingSessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


app.dependency_overrides[get_db] = _override_get_db


@pytest.fixture(scope="session")
def client() -> TestClient:
    """Тестовый HTTP-клиент с инициализацией приложения."""
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def isolated_client():
    """Клиент на отдельной in-memory БД (не влияет на общие фикстуры).

    Возвращает пару ``(client, session_factory)``.
    """
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    def override_get_db():
        session = session_factory()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    original = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_db] = override_get_db
    test_client = TestClient(app)
    try:
        yield test_client, session_factory
    finally:
        if original is not None:
            app.dependency_overrides[get_db] = original
        else:
            app.dependency_overrides.pop(get_db, None)


@pytest.fixture(scope="session")
def loaded_scenario(client: TestClient) -> dict:
    """Загружает тестовый сценарий и возвращает его сводку."""
    response = client.post("/api/v1/data/load", json=SMALL_SCENARIO)
    assert response.status_code == 201, response.text
    return response.json()


@pytest.fixture(scope="session")
def planned(client: TestClient, loaded_scenario: dict) -> dict:
    """Запускает планирование один раз для всего набора тестов."""
    response = client.post(
        "/api/v1/planning/run",
        json={
            "scenario_id": loaded_scenario["scenario_id"],
            "time_limit_seconds": 3,
            "seed": 7,
            "include_baseline": True,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()

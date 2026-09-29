"""Тесты удаления сущностей и каскадной очистки БД."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.storage.database import Base, get_db
from app.storage.models import Event, Plan, Scenario
from app.storage.repository import Repository
from tests.conftest import SMALL_SCENARIO


@pytest.fixture
def isolated():
    """Изолированная БД и клиент, чтобы тесты удаления не ломали общие фикстуры."""
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
    client = TestClient(app)
    try:
        yield client, session_factory
    finally:
        if original is not None:
            app.dependency_overrides[get_db] = original
        else:
            app.dependency_overrides.pop(get_db, None)


def _load_scenario(client: TestClient) -> str:
    """Загружает тестовый сценарий и возвращает его ID."""
    response = client.post("/api/v1/data/load", json=SMALL_SCENARIO)
    assert response.status_code == 201, response.text
    return response.json()["scenario_id"]


def _add_plan(session_factory, scenario_id: str, parent_plan_id: str | None = None) -> str:
    """Создаёт план напрямую через репозиторий (без запуска решателя)."""
    session = session_factory()
    try:
        plan = Repository(session).create_plan(
            scenario_id=scenario_id,
            input_payload={"engineers": [], "requests": []},
            result={},
            metrics={},
            algorithm_meta={},
            parent_plan_id=parent_plan_id,
        )
        session.commit()
        return plan.id
    finally:
        session.close()


def _counts(session_factory) -> tuple[int, int, int]:
    """Возвращает число сценариев, планов и событий в изолированной БД."""
    session = session_factory()
    try:
        return (
            session.scalar(select(func.count()).select_from(Scenario)) or 0,
            session.scalar(select(func.count()).select_from(Plan)) or 0,
            session.scalar(select(func.count()).select_from(Event)) or 0,
        )
    finally:
        session.close()


def _get(session_factory, model, primary_key: str):
    """Читает запись по первичному ключу в отдельной сессии."""
    session = session_factory()
    try:
        return session.get(model, primary_key)
    finally:
        session.close()


def test_delete_scenario_removes_plans_and_events(isolated) -> None:
    """Удаление сценария убирает связанные планы, события и производные сценарии."""
    client, session_factory = isolated
    scenario_id = _load_scenario(client)
    plan_id = _add_plan(session_factory, scenario_id)

    session = session_factory()
    try:
        repository = Repository(session)
        derived = repository.create_scenario(engineers=[], requests=[], name="Версия после события")
        repository.create_plan(
            scenario_id=derived.id,
            input_payload={},
            result={},
            metrics={},
            algorithm_meta={},
            parent_plan_id=plan_id,
            kind="replanned",
        )
        repository.create_event(
            event_type="urgent_request",
            payload={"type": "urgent_request"},
            plan_id=plan_id,
            scenario_id=scenario_id,
        )
        session.commit()
    finally:
        session.close()

    assert _counts(session_factory) == (2, 2, 1)

    response = client.delete(f"/api/v1/data/scenarios/{scenario_id}")
    assert response.status_code == 200, response.text

    # Исходный и производный сценарии, планы и событие удалены.
    assert _counts(session_factory) == (0, 0, 0)
    assert client.get(f"/api/v1/data/scenarios/{scenario_id}").status_code == 404


def test_delete_unknown_scenario_returns_404(isolated) -> None:
    """Удаление несуществующего сценария возвращает 404."""
    client, _ = isolated
    assert client.delete("/api/v1/data/scenarios/missing").status_code == 404


def test_delete_all_scenarios(isolated) -> None:
    """Удаление всех сценариев очищает сценарии, планы и события."""
    client, session_factory = isolated
    first = _load_scenario(client)
    second = _load_scenario(client)
    _add_plan(session_factory, first)
    _add_plan(session_factory, second)

    response = client.delete("/api/v1/data/scenarios")
    assert response.status_code == 200, response.text
    assert "2" in response.json()["message"]
    assert _counts(session_factory) == (0, 0, 0)


def test_delete_plan_and_event(isolated) -> None:
    """Удаление плана и события по ID работает и возвращает 404 для отсутствующих."""
    client, session_factory = isolated
    scenario_id = _load_scenario(client)
    plan_id = _add_plan(session_factory, scenario_id)

    session = session_factory()
    try:
        event = Repository(session).create_event(
            event_type="request_cancelled",
            payload={},
            plan_id=plan_id,
            scenario_id=scenario_id,
        )
        session.commit()
        event_id = event.id
    finally:
        session.close()

    assert client.delete(f"/api/v1/planning/{plan_id}").status_code == 200
    assert _get(session_factory, Plan, plan_id) is None
    assert _get(session_factory, Event, event_id) is None

    assert client.delete(f"/api/v1/events/{event_id}").status_code == 404
    assert client.delete("/api/v1/planning/missing").status_code == 404
    assert client.delete("/api/v1/events/missing").status_code == 404


def test_delete_all_plans_and_events(isolated) -> None:
    """Delete-all по планам и событиям очищает соответствующие таблицы."""
    client, session_factory = isolated
    scenario_id = _load_scenario(client)
    plan_id = _add_plan(session_factory, scenario_id)

    session = session_factory()
    try:
        Repository(session).create_event(event_type="urgent_request", payload={}, plan_id=plan_id)
        session.commit()
    finally:
        session.close()

    assert client.delete("/api/v1/events").status_code == 200
    assert _counts(session_factory)[2] == 0

    assert client.delete("/api/v1/planning").status_code == 200
    assert _counts(session_factory)[1] == 0
    # Сценарий при удалении всех планов сохраняется.
    assert _counts(session_factory)[0] == 1

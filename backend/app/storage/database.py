"""Подключение к базе данных и сессии SQLAlchemy.

Архитектурно это тонкий слой: сервисы работают с репозиторием, а не с
SQL-запросами напрямую. По умолчанию используется SQLite, но при задании
``DATABASE_URL`` можно переключиться на PostgreSQL без изменения кода.
"""
from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import get_settings


class Base(DeclarativeBase):
    """Базовый класс декларативных моделей."""


def _create_engine(url: str) -> Engine:
    """Создаёт движок SQLAlchemy с корректными параметрами для SQLite/Postgres."""
    connect_args: dict = {}
    if url.startswith("sqlite"):
        # SQLite не терпит обращения из разных потоков FastAPI по умолчанию.
        connect_args["check_same_thread"] = False
    return create_engine(url, connect_args=connect_args, pool_pre_ping=True, future=True)


_settings = get_settings()
engine: Engine = _create_engine(_settings.resolve_database_url())
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def init_db(target_engine: Engine | None = None) -> None:
    """Создаёт таблицы, если они ещё не существуют."""
    from app.storage import models  # noqa: F401  (нужно для регистрации моделей)

    Base.metadata.create_all(bind=target_engine or engine)


def get_db() -> Iterator[Session]:
    """FastAPI-зависимость: выдаёт сессию БД и гарантированно её закрывает."""
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()

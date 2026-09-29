"""Сид демо-дня Востока на сегодня с часами (D-24).

Идемпотентно создаёт день, строит и публикует план, ставит `clock` и выполняет
автопрогон, чтобы стенд был «в середине рабочего дня» в любое время суток.
"""
from __future__ import annotations

import logging
import threading
import zlib

from app.core.config import get_settings
from app.core.timeutils import today_str

logger = logging.getLogger(__name__)

#: Локальная блокировка от гонки в одном процессе (п. 43).
_seed_lock = threading.Lock()


def _advisory_lock(repository, region_id: str, date: str) -> bool:
    """Postgres advisory-lock на (участок, дата), чтобы не создать копии (п. 43)."""
    try:
        bind = repository.session.get_bind()
        if bind.dialect.name != "postgresql":
            return True
        from sqlalchemy import text

        key = zlib.crc32(f"{region_id}:{date}".encode("utf-8")) & 0x7FFFFFFF
        return bool(
            repository.session.execute(
                text("SELECT pg_try_advisory_lock(:key)"), {"key": key}
            ).scalar()
        )
    except Exception:  # noqa: BLE001 — блокировка не должна ронять сид
        return True


def _advisory_unlock(repository, region_id: str, date: str) -> None:
    try:
        bind = repository.session.get_bind()
        if bind.dialect.name != "postgresql":
            return
        from sqlalchemy import text

        key = zlib.crc32(f"{region_id}:{date}".encode("utf-8")) & 0x7FFFFFFF
        repository.session.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": key})
        repository.session.commit()
    except Exception:  # noqa: BLE001
        pass


def seed_demo_day(repository) -> bool:
    """Создаёт демо-день Востока, если его ещё нет. Возвращает факт создания."""
    settings = get_settings()
    if not settings.seed_demo_day:
        return False
    return ensure_demo_day(repository, settings.default_region_id, today_str())


def ensure_demo_day(repository, region_id: str, date: str) -> bool:
    """Лениво создаёт демо-день региона на дату, если его ещё нет (п. 18, 30, 43).

    Идемпотентно: если на (регион, дата) уже есть живой день кейса — ничего не
    делает. Если день состоял из одних записей оператора — создаёт настоящий день,
    переносит записи и архивирует день записей. Создание защищено блокировкой.
    """
    settings = get_settings()
    if not settings.seed_demo_day:
        return False
    from app.core.regions import get_region, is_builtin

    # демо-день — только у участков кейса; у своего участка (§14) демо-данных нет
    if not is_builtin(region_id):
        return False
    region = get_region(region_id)
    if region is None:
        return False

    with _seed_lock:
        if not _advisory_lock(repository, region_id, date):
            return False
        try:
            all_days = [
                item
                for item in repository.find_scenarios(region_id=region_id, date=date, limit=20)
                if not (item.scenario_metadata or {}).get("archived")
            ]
            real = [item for item in all_days if (item.scenario_metadata or {}).get("source") != "booking"]
            if real:
                return False
            booking_days = [item for item in all_days if item.requests]
            extra_requests = [dict(r) for day in booking_days for r in day.requests]
            # день из одних записей оператора: переносим записи и архивируем его
            for day in booking_days:
                meta = dict(day.scenario_metadata or {})
                meta["archived"] = True
                day.scenario_metadata = meta
                repository.update_scenario(day)
            return _create_demo(
                repository, region, region_id, date, settings, extra_requests
            )
        finally:
            _advisory_unlock(repository, region_id, date)


def _create_demo(repository, region, region_id, date, settings, extra_requests) -> bool:
    from app.services.day_clock import autoplay
    from app.services.region_dataset import build_region_scenario

    dataset = build_region_scenario(region_id, date)
    # Записи оператора из дня-предшественника переносим в настоящий день (п. 30).
    dataset["requests"].extend(extra_requests)
    scenario = repository.create_scenario(
        engineers=dataset["engineers"],
        requests=dataset["requests"],
        name=dataset["name"],
        description=dataset["description"],
        scenario_metadata=dataset["scenario_metadata"],
    )
    try:
        from app.api.deps import get_planner_service

        planner = get_planner_service()
        computation = planner.compute(
            scenario.engineers,
            scenario.requests,
            include_baseline=False,
            time_limit=6.0,
        )
    except Exception as exc:  # noqa: BLE001 — сид не должен ронять сервис
        logger.warning("Не удалось построить демо-план: %s", exc)
        return False

    report = computation.report
    algorithm_meta = {
        "solver": "hybrid_v2",
        "seed": 42,
        "elapsed_seconds": round(
            float(computation.algorithm_meta.get("elapsed_seconds") or 0.0), 3
        ),
        "road_factor": computation.problem.road_factor,
        "matrix_sources": computation.problem.matrix_sources,
        "warnings": computation.problem.warnings,
        "strategy": "ours",
        "version": 1,
        "algorithm_report": report,
        "solver_metadata": report.get("metadata", {}),
    }
    plan = repository.create_plan(
        scenario_id=scenario.id,
        input_payload={
            "engineers": computation.problem.engineers,
            "requests": computation.problem.requests,
            "name": scenario.name,
        },
        result=computation.api_result,
        metrics=None,
        algorithm_meta=algorithm_meta,
        kind="optimized",
        status="applied",
    )
    metadata = dict(scenario.scenario_metadata or {})
    metadata["active_plan_id"] = plan.id
    metadata["version"] = 1
    metadata["clock"] = settings.demo_clock
    scenario.scenario_metadata = metadata
    repository.update_scenario(scenario)
    try:
        autoplay(repository, scenario, settings.demo_clock)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Автопрогон демо-дня не удался: %s", exc)
    logger.info(
        "Сид демо-дня: %s %s, план %s, clock %s",
        region["name"],
        date,
        plan.id,
        settings.demo_clock,
    )
    return True

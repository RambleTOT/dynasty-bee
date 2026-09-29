"""Часы дня (D-24): у каждого сценария свои «сейчас».

`clock = null` — реальное время Europe/Moscow. Если задан — все события, нажатия
инженеров и заморозка считаются по этому времени, а автопрогон переводит
запланированные визиты в факты, чтобы демо работало 24/7.
"""
from __future__ import annotations

import logging

from app.core.timeutils import now_hhmm
from app.schemas.validators import minutes_to_time, time_to_minutes

logger = logging.getLogger(__name__)


def scenario_clock(scenario) -> str | None:
    """Часы дня сценария (``HH:MM``) или ``None`` (реальное время)."""
    if scenario is None:
        return None
    return (scenario.scenario_metadata or {}).get("clock")


def resolve_now(repository, scenario_id: str | None) -> str:
    """«Сейчас» для дня: часы сценария или реальное время."""
    if scenario_id:
        scenario = repository.get_scenario(scenario_id)
        clock = scenario_clock(scenario)
        if clock:
            return clock
    return now_hhmm()


def autoplay(repository, scenario, day_time: str) -> dict[str, int]:
    """Переводит визиты применённого плана в факты по времени ``day_time``.

    Возвращает число визитов, ставших ``done`` / ``in_progress`` / ``en_route``.
    Уже начатые инженером визиты (не ``planned``) не трогаем.
    """
    now_min = time_to_minutes(day_time)
    counts = {"done": 0, "in_progress": 0, "en_route": 0}
    plan = _applied_plan(repository, scenario.id)
    if plan is None:
        return counts

    result = plan.result or {}
    requests_by_id = {item["id"]: item for item in scenario.requests}
    for item in (plan.input_payload or {}).get("requests", []):
        requests_by_id.setdefault(item["id"], item)
    engineers_by_id = {item["id"]: item for item in scenario.engineers}
    for item in (plan.input_payload or {}).get("engineers", []):
        engineers_by_id.setdefault(item["id"], item)
    changed = False
    for route in result.get("routes", []):
        engineer = engineers_by_id.get(route["engineer_id"])
        for point in route.get("route", []):
            if point.get("status") not in (None, "planned"):
                continue
            start = _to_min(point.get("start"))
            end = _to_min(point.get("end"))
            arrival = _to_min(point.get("arrival"))
            if start is None or end is None:
                continue
            if end <= now_min:
                point["status"] = "done"
                point["actual_arrival"] = point.get("arrival")
                point["actual_start"] = point.get("start")
                point["actual_end"] = point.get("end")
                counts["done"] += 1
            elif start <= now_min < end:
                point["status"] = "in_progress"
                point["actual_arrival"] = point.get("arrival")
                point["actual_start"] = point.get("start")
                counts["in_progress"] += 1
            elif arrival is not None and arrival <= now_min < start:
                point["status"] = "en_route"
                counts["en_route"] += 1
            else:
                continue
            changed = True
            request = requests_by_id.get(point["request_id"])
            if request is not None:
                request["status"] = point["status"]
            if engineer is not None and point["status"] in {"done", "in_progress", "en_route"}:
                engineer["shift_status"] = "on_shift"
                engineer["actual_transport"] = engineer.get("actual_transport") or engineer["transport"]
    if changed:
        repository.save_plan(plan)
        repository.update_scenario(scenario)
    counts["total"] = counts["done"] + counts["in_progress"] + counts["en_route"]
    return counts


def _applied_plan(repository, scenario_id: str):
    from app.services.day_plan import active_plan

    scenario = repository.get_scenario(scenario_id)
    plan = active_plan(repository, scenario)
    if plan is not None:
        return plan
    plans = repository.list_plans(scenario_id=scenario_id, limit=200)
    return next((plan for plan in plans if plan.status == "applied"), None)


def _to_min(value: str | None) -> int | None:
    if not value:
        return None
    try:
        return time_to_minutes(value)
    except ValueError:
        return None

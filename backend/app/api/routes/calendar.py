"""Календарь заявок и день по регионам (D-20)."""
from __future__ import annotations

from collections import Counter
from datetime import date as date_cls, timedelta

from fastapi import APIRouter, Depends, Query, Security

from app.api.deps import get_repository, require_roles, verify_token
from app.core.regions import REGIONS, get_region, list_regions
from app.core.timeutils import today_str
from app.storage.repository import Repository

router = APIRouter(tags=["Календарь"], dependencies=[Security(verify_token)])


def _request_statuses(requests: list[dict]) -> Counter:
    return Counter(item.get("status", "unassigned") for item in requests)


def _overall_state(scenario, repository) -> dict:
    """Состояние дня: активный/черновой план, версия, предложения."""
    from app.services.day_plan import active_plan, pending_proposals

    plans = repository.list_plans(scenario_id=scenario.id, limit=100)
    active = active_plan(repository, scenario)
    draft = next((p for p in plans if p.status == "draft"), None)
    base = active or draft
    proposals = pending_proposals(repository, base)
    metadata = scenario.scenario_metadata or {}
    version = int(
        metadata.get("version")
        or ((active.algorithm_meta or {}).get("version", 0) if active else 0)
        or 0
    )
    if active is not None:
        plan_state = "applied"
    elif draft is not None:
        plan_state = "draft"
    else:
        plan_state = "none"
    return {
        "active_plan_id": active.id if active else None,
        "draft_plan_id": draft.id if draft else None,
        "plan_state": plan_state,
        "version": version,
        "pending_proposals": [
            {
                "plan_id": p.id,
                "event_id": (p.algorithm_meta or {}).get("event_id"),
                "event_type": (p.algorithm_meta or {}).get("event_type"),
                "headline": (p.algorithm_meta or {}).get("headline", "Предложение ждёт решения"),
                "created_at": p.created_at,
            }
            for p in proposals
        ],
        "last_recalc": metadata.get("last_recalc"),
    }


def _scenario_requests_with_status(scenario, plan) -> list[dict]:
    """Заявки сценария + версии плана с фактическими статусами визитов."""
    requests = [dict(item) for item in scenario.requests]
    known = {item["id"] for item in requests}
    for item in (plan.input_payload or {}).get("requests", []):
        if item["id"] not in known:
            requests.append(dict(item))
            known.add(item["id"])
    status_map: dict[str, str] = {}
    for route in (plan.result or {}).get("routes", []):
        for point in route.get("route", []):
            status_map[point["request_id"]] = point.get("status", "planned")
    for item in (plan.result or {}).get("unassigned", []):
        request_id = item.get("request_id") or item.get("task_id")
        if request_id:
            status_map[request_id] = "unassigned"
    for request in requests:
        request["status"] = status_map.get(request["id"], request.get("status", "unassigned"))
    return requests


@router.get("/calendar", summary="Календарь заявок по дням")
def get_calendar(
    date_from: str | None = Query(None, alias="from", description="Начало периода YYYY-MM-DD"),
    date_to: str | None = Query(None, alias="to", description="Конец периода YYYY-MM-DD"),
    region_id: str = Query("all", description="all | east | south_east | south_center"),
    status: str | None = Query(None, description="Фильтр по статусам через запятую"),
    type_bk: str | None = Query(None, description="Фильтр по типу BK через запятую"),
    flag: str | None = Query(None, description="Фильтр по флагам через запятую"),
    repository: Repository = Depends(get_repository),
) -> dict:
    """Считает количество заявок по дням и статусам."""
    from app.core.timeutils import today_str

    start = date_cls.fromisoformat(date_from) if date_from else date_cls.fromisoformat(today_str())
    end = date_cls.fromisoformat(date_to) if date_to else start + timedelta(days=30)
    status_filter = set(status.split(",")) if status else None
    type_filter = set(type_bk.split(",")) if type_bk else None
    flag_filter = set(flag.split(",")) if flag else None

    # Лениво создаём демо-день на сегодня, если его ещё нет (п. 18).
    today = date_cls.fromisoformat(today_str())
    if start <= today <= end:
        from app.services.demo_seed import ensure_demo_day

        target_regions = list(REGIONS.keys()) if region_id == "all" else [region_id]
        for rid in target_regions:
            ensure_demo_day(repository, rid, today.isoformat())

    scenarios = repository.find_scenarios(limit=500)
    by_date: dict[str, dict] = {}
    for scenario in scenarios:
        meta = scenario.scenario_metadata or {}
        if meta.get("archived"):
            # Архивные дни не считаются как живые (п. 27).
            continue
        day = meta.get("date")
        if not day:
            continue
        scenario_region = meta.get("region_id")
        if region_id != "all" and scenario_region != region_id:
            continue
        if not (start.isoformat() <= day <= end.isoformat()):
            continue
        from app.services.day_plan import active_plan

        plan = active_plan(repository, scenario)
        requests = scenario.requests
        if plan is not None:
            requests = _scenario_requests_with_status(scenario, plan)
        if type_filter:
            requests = [r for r in requests if r.get("type_bk") in type_filter]
        if flag_filter:
            requests = [
                r
                for r in requests
                if set(r.get("flags", [])) & flag_filter
                or ("urgent" in flag_filter and r.get("priority") == "urgent")
            ]
        statuses = _request_statuses(requests)
        if status_filter:
            statuses = Counter({k: v for k, v in statuses.items() if k in status_filter})
        entry = by_date.setdefault(
            day, {"date": day, "request_count": 0, "by_status": Counter(), "flags": Counter(), "sources": set()}
        )
        entry["request_count"] += sum(statuses.values())
        entry["by_status"].update(statuses)
        entry["flags"]["urgent"] += sum(1 for r in requests if r.get("priority") == "urgent")
        if meta.get("source"):
            entry["sources"].add(meta["source"])

    days = []
    for day in sorted(by_date):
        entry = by_date[day]
        days.append(
            {
                "date": entry["date"],
                "request_count": entry["request_count"],
                "by_status": dict(entry["by_status"]),
                "flags": dict(entry["flags"]),
                "sources": sorted(entry["sources"]),
            }
        )
    return {"days": days}


@router.get("/days/{date}", summary="Состояние дня по регионам")
def get_day(
    date: str,
    region_id: str = Query("all", description="all | east | south_east | south_center"),
    repository: Repository = Depends(get_repository),
) -> dict:
    """Возвращает состояние дня по регионам: планы, версии, предложения."""
    scenarios = repository.find_scenarios(date=date, limit=100)
    result = []
    region_ids = (
        [region_id] if region_id != "all" else [r["region_id"] for r in list_regions(repository)]
    )
    for rid in region_ids:
        # На сегодня лениво поднимаем демо-день; день из одних записей оператора
        # превращается в настоящий (п. 18, 30).
        if date == today_str():
            from app.services.demo_seed import ensure_demo_day

            ensure_demo_day(repository, rid, date)
        scenario = next(
            (
                s
                for s in repository.find_scenarios(date=date, limit=100)
                if (s.scenario_metadata or {}).get("region_id") == rid
                and not (s.scenario_metadata or {}).get("archived")
            ),
            None,
        )
        if scenario is None:
            continue
        state = _overall_state(scenario, repository)
        from app.services.day_clock import scenario_clock

        result.append(
            {
                "region_id": rid,
                "name": (get_region(rid, repository) or {}).get("name", rid),
                "scenario_id": scenario.id,
                "source": (scenario.scenario_metadata or {}).get("source"),
                "office": (scenario.scenario_metadata or {}).get("office"),
                "clock": scenario_clock(scenario),
                **state,
            }
        )
    return {"date": date, "regions": result}


@router.post(
    "/days/{date}/clear",
    summary="Удалить день (п. 37)",
    dependencies=[Depends(require_roles("dispatcher"))],
)
def clear_day(
    date: str,
    region_id: str = Query(..., description="ID участка"),
    repository: Repository = Depends(get_repository),
) -> dict:
    """Удаляет день целиком: сценарии, версии, планы, события, действия инженеров."""
    if get_region(region_id, repository) is None:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="Неизвестный регион")
    counts = repository.clear_day(region_id, date)
    try:
        from app.realtime.hub import hub

        hub.publish("day.cleared", region_id=region_id, date=date, data={"region_id": region_id})
    except Exception:  # noqa: BLE001
        pass
    return {"region_id": region_id, "date": date, **counts}

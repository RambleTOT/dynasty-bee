"""Оператор: окна, запись, отмена, перенос (сценарий B)."""
from __future__ import annotations

import copy
from typing import Any

from fastapi import Security, APIRouter, Depends, HTTPException, status

from app.api.deps import verify_token, get_planner_service, get_replan_engine, get_repository
from app.core.constants import car_by_rule, normalize_skill, normalize_transport
from app.core.regions import build_region_roster, get_region, norm_for
from app.schemas.event import ApplyEventRequest
from app.schemas.extras import (
    BookingCancelIn,
    BookingRequestIn,
    BookingRequestOut,
    BookingRescheduleIn,
    BookingSlotsResponse,
    SlotOut,
)
from app.services.plan_persistence import persist_replan
from app.services.region_dataset import build_region_scenario
from app.storage.repository import Repository

router = APIRouter(prefix="/booking", tags=["Оператор"], dependencies=[Security(verify_token)])

WINDOWS = [
    "10:00-12:00",
    "12:00-14:00",
    "14:00-16:00",
    "16:00-18:00",
    "18:00-20:00",
    "20:00-22:00",
]

_DURATION_BY_TYPE = {
    "подключение": ("installation", 70),
    "дозаказ": ("installation", 20),
    "локальная заявка": ("local", 30),
    "глобальная проблема": ("emergency", 80),
}


def _skill_duration(type_bk: str | None, region: dict | None = None) -> tuple[str, int]:
    """Навык и длительность: у своего участка (§14) — его нормативы, у участков кейса — Билайна."""
    if region is not None and not region.get("builtin", True):
        return norm_for(region, type_bk) or ("local", 30)
    return _DURATION_BY_TYPE.get((type_bk or "").strip().lower(), ("local", 30))


def _find_scenario(repository: Repository, region_id: str, date: str, source: str | None = None):
    """Исходный (не производный, не архивный) сценарий дня региона."""
    for scenario in repository.find_scenarios(region_id=region_id, date=date, limit=20):
        meta = scenario.scenario_metadata or {}
        if meta.get("derived_from_scenario") or meta.get("archived"):
            continue
        if source and meta.get("source") != source:
            continue
        return scenario
    return None


def _days_plan(repository: Repository, scenario):
    """(действующий план, применён ли день) для сценария дня."""
    from app.services.day_plan import active_plan, day_plan

    active = active_plan(repository, scenario)
    if active is not None:
        return active, True
    return day_plan(repository, scenario), False


def _next_booking_id(repository: Repository, scenario) -> str:
    """Уникальный номер записи по всему дню: исходный сценарий и все версии (п. 36)."""
    from app.services.day_plan import root_scenario

    root = root_scenario(repository, scenario) or scenario
    date = (root.scenario_metadata or {}).get("date") or (scenario.scenario_metadata or {}).get("date", "")
    compact = date.replace("-", "")
    prefix = f"BK-{compact}-"
    existing: set[str] = set()
    day_scenarios = [
        item
        for item in repository.list_scenarios(limit=1000)
        if item.id == root.id
        or (item.scenario_metadata or {}).get("root_scenario_id") == root.id
        or (item.scenario_metadata or {}).get("derived_from_scenario") == root.id
    ]
    for day_scenario in day_scenarios:
        for request in day_scenario.requests:
            if (request.get("id") or "").startswith(prefix):
                existing.add(request["id"])
        for plan in repository.list_plans(scenario_id=day_scenario.id, limit=200):
            for request in (plan.input_payload or {}).get("requests", []):
                if (request.get("id") or "").startswith(prefix):
                    existing.add(request["id"])
    index = 1
    while f"{prefix}{index:04d}" in existing:
        index += 1
    return f"{prefix}{index:04d}"


def _lookup_district(repository: Repository, region_id: str, address: str | None) -> str | None:
    """Район по адресу из уже загруженных заявок региона (кэш геокодера)."""
    if not address:
        return None
    needle = address.strip().lower()
    if not needle:
        return None
    for scenario in repository.find_scenarios(region_id=region_id, limit=300):
        for request in scenario.requests:
            if (request.get("address") or "").strip().lower() == needle and request.get("district"):
                return request["district"]
    return None


def _get_or_create_scenario(repository: Repository, region_id: str, date: str):
    scenario = _find_scenario(repository, region_id, date)
    if scenario is not None:
        return scenario
    region = get_region(region_id, repository)
    if region is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Неизвестный регион")
    if not region.get("builtin", True):
        # свой участок (§14): день записи — с ростером участка, без демо-заявок
        engineers = build_region_roster(region)
        if not engineers:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"error": {"code": "NO_ROSTER", "message": "У участка нет бригад: загрузите файл участка"}},
            )
        return repository.create_scenario(
            engineers=engineers,
            requests=[],
            name=f"{region['name']} · {date} · запись",
            description="Рабочий день, созданный оператором",
            scenario_metadata={"region_id": region_id, "date": date, "source": "booking", "office": region["office"]},
        )
    dataset = build_region_scenario(region_id, date)
    dataset["scenario_metadata"]["source"] = "booking"
    return repository.create_scenario(
        engineers=dataset["engineers"],
        requests=[],
        name=f"{region['name']} · {date} · запись",
        description="Рабочий день, созданный оператором",
        scenario_metadata=dataset["scenario_metadata"],
    )


def _overlaps(window: str, other_start: str, other_end: str) -> bool:
    start, end = window.split("-")
    return not (end <= other_start or start >= other_end)


def _engineers_for(scenario, required_skill: str, required_transport: str | None) -> list[dict]:
    result = []
    for engineer in scenario.engineers:
        if required_skill not in engineer.get("skills", []):
            continue
        if required_transport and engineer.get("transport") != required_transport:
            continue
        if not engineer.get("available", True):
            continue
        result.append(engineer)
    return result


@router.get(
    "/slots",
    response_model=BookingSlotsResponse,
    summary="Свободные окна на дату",
    description="Оценивает доступность 6 окон по навыку, транспорту и занятости инженеров.",
)
def booking_slots(
    region_id: str,
    date: str,
    type_bk: str = "Подключение",
    type_hd: str | None = None,
    address: str | None = None,
    gigabit: bool = False,
    required_transport: str | None = None,
    repository: Repository = Depends(get_repository),
    engine=Depends(get_replan_engine),
) -> BookingSlotsResponse:
    """Возвращает доступность окон."""
    region = get_region(region_id, repository)
    if region is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Неизвестный регион")
    skill, duration = _skill_duration(type_bk, region)
    transport = normalize_transport(required_transport) if required_transport else None
    if transport is None and car_by_rule(type_hd):
        transport = "car"

    scenario = _find_scenario(repository, region_id, date)
    if scenario:
        engineers = scenario.engineers
    elif region.get("builtin", True):
        engineers = build_region_scenario(region_id, date)["engineers"]
    else:
        engineers = build_region_roster(region)
    requests = scenario.requests if scenario else []
    eligible = [
        engineer
        for engineer in engineers
        if skill in engineer.get("skills", [])
        and (transport is None or engineer.get("transport") == transport)
    ]

    slots: list[SlotOut] = []
    from app.core.timeutils import now_hhmm, today_str
    from app.services.day_clock import scenario_clock

    day_clock = (
        (scenario_clock(scenario) or now_hhmm()) if date == today_str() else None
    )

    # Свободно ли окно по действующему плану: пробуем встроить заявку (п. 50).
    plan_problem = None
    plan_routes: list = []
    slot_index: dict[str, int] = {}
    slot_evaluator = None
    if scenario is not None:
        from app.services.day_plan import active_plan
        from app.services.route_service import report_to_index_routes

        plan = active_plan(repository, scenario)
        if plan is not None:
            base = [
                item
                for item in (plan.input_payload or {}).get("requests", [])
                if item.get("status") not in {"cancelled", "rescheduled"}
            ]
            office = (scenario.scenario_metadata or {}).get("office", {})
            lat, lon = office.get("lat", 55.75), office.get("lon", 37.62)
            if address:
                from app.core.config import get_settings
                from app.services.geocoder import Geocoder

                geocoder = Geocoder(repository, get_settings())
                coords = geocoder.geocode(address) if geocoder.provider != "none" else None
                if coords is not None:
                    lat, lon = coords
            release = 0
            if day_clock:
                from app.schemas.validators import time_to_minutes

                release = time_to_minutes(day_clock)
            candidates = []
            for window in WINDOWS:
                w_start, w_end = window.split("-")
                candidates.append(
                    {
                        "id": f"_slot_{window}",
                        "latitude": lat,
                        "longitude": lon,
                        "address": address,
                        "duration_minutes": duration,
                        "window_start": w_start,
                        "window_end": w_end,
                        "priority": "urgent" if skill == "emergency" else "normal",
                        "required_skill": skill,
                        "required_transport": transport,
                        "release_time": release,
                        "source": "operator",
                    }
                )
            try:
                plan_problem = engine.adapter.prepare_problem(scenario.engineers, base + candidates)
                plan_routes = report_to_index_routes(
                    plan_problem, (plan.algorithm_meta or {}).get("algorithm_report") or {}
                )
                base_n = len(base)
                slot_index = {window: base_n + i for i, window in enumerate(WINDOWS)}
                slot_evaluator = engine.adapter.evaluator(plan_problem)
            except Exception:  # noqa: BLE001 — при ошибке остаётся прежняя оценка
                plan_problem = None

    for window in WINDOWS:
        start, end = window.split("-")
        if day_clock and start < day_clock:
            slots.append(
                SlotOut(
                    window=window,
                    available=False,
                    reason_code="WINDOW_PASSED",
                    reason="Окно уже началось",
                )
            )
            continue
        if not eligible:
            slots.append(
                SlotOut(
                    window=window,
                    available=False,
                    reason_code="NO_SKILL" if not transport else "NO_TRANSPORT",
                    reason="Нет подходящего инженера по навыку или транспорту",
                )
            )
            continue
        if slot_evaluator is not None:
            index = slot_index.get(window)
            insertable = any(
                slot_evaluator.insert(k, plan_routes[k], index)[0] >= 0
                for k in range(len(plan_routes))
                if plan_routes
            )
            if not insertable:
                slots.append(
                    SlotOut(
                        window=window,
                        available=False,
                        reason_code="NO_CAPACITY",
                        reason=f"Бригаду не поставить в окно {start}–{end} с учётом текущего плана",
                    )
                )
                continue
        free = 0
        for engineer in eligible:
            engineer_busy = False
            for request in requests:
                if request.get("_tentative_engineer_id") == engineer["id"] and _overlaps(
                    window, request.get("window_start", "00:00"), request.get("window_end", "00:00")
                ):
                    engineer_busy = True
                    break
            if not engineer_busy:
                free += 1
        if free == 0:
            slots.append(
                SlotOut(
                    window=window,
                    available=False,
                    reason_code="NO_CAPACITY",
                    reason=f"Все инженеры с навыком заняты {start}–{end}",
                )
            )
        else:
            slots.append(SlotOut(window=window, available=True))
    return BookingSlotsResponse(
        region_id=region_id,
        date=date,
        required_skill=skill,
        duration_minutes=duration,
        required_transport=transport,
        district=_lookup_district(repository, region_id, address),
        slots=slots,
    )


@router.post(
    "/requests",
    response_model=BookingRequestOut,
    status_code=status.HTTP_201_CREATED,
    summary="Записать клиента в окно",
)
def create_booking_request(
    payload: BookingRequestIn,
    repository: Repository = Depends(get_repository),
    planner=Depends(get_planner_service),
    engine=Depends(get_replan_engine),
) -> BookingRequestOut:
    """Создаёт заявку в рабочем дне региона."""
    region = get_region(payload.region_id, repository)
    if region is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Неизвестный регион")
    if payload.window not in WINDOWS:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Неизвестное окно")
    skill, duration = _skill_duration(payload.type_bk, region)
    transport = normalize_transport(payload.required_transport) if payload.required_transport else None
    if transport is None and car_by_rule(payload.type_hd):
        transport = "car"

    scenario = _get_or_create_scenario(repository, payload.region_id, payload.date)
    request_id = _next_booking_id(repository, scenario)
    start, end = payload.window.split("-")
    office = scenario.scenario_metadata.get("office", {})
    eligible = _engineers_for(scenario, skill, transport)
    if not eligible:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"error": {"code": "SLOT_TAKEN", "message": "Нет подходящего инженера"}},
        )
    tentative = eligible[0]["id"]
    latitude = round(office.get("lat", 55.75) + 0.01, 6)
    longitude = round(office.get("lon", 37.62) + 0.01, 6)
    if payload.address:
        from app.core.config import get_settings
        from app.services.geocoder import Geocoder

        geocoder = Geocoder(repository, get_settings())
        coords = geocoder.geocode(payload.address) if geocoder.provider != "none" else None
        if coords is not None:
            latitude, longitude = coords
    request = {
        "id": request_id,
        "latitude": latitude,
        "longitude": longitude,
        "address": payload.address,
        "district": payload.district,
        "type_bk": payload.type_bk,
        "type_hd": payload.type_hd,
        "gigabit": payload.gigabit,
        "technology": payload.technology,
        "duration_minutes": duration,
        "window_start": start,
        "window_end": end,
        "priority": "urgent" if skill == "emergency" else "normal",
        "priority_rank": 1 if skill == "emergency" else (2 if skill == "installation" else 3),
        "required_skill": skill,
        "required_transport": transport,
        "release_time": 0,
        "source": "operator",
        "client_window_locked": True,
        "status": "planned",
        "_tentative_engineer_id": tentative,
        "_client_contact": payload.client_contact,
    }
    active, started = _days_plan(repository, scenario)
    date_label = _ru_date(payload.date)
    if started and active is not None:
        # Начатый день: встраиваем событием без пересчёта с нуля (п. 17).
        plan_id, engineer_id = _embed_booking_event(
            repository, engine, active, scenario, request
        )
    else:
        requests = list(scenario.requests)
        requests.append(request)
        scenario.requests = requests
        repository.update_scenario(scenario)
        plan_id, _state, engineer_id, _version = _recalc_after_change(
            repository, planner, scenario, request_id
        )
        if engineer_id is None:
            request["status"] = "unassigned"
            repository.update_scenario(scenario)
    if engineer_id:
        message = f"Заявка №{request_id} записана на {date_label}, {start}–{end}. План дня пересчитан"
    else:
        message = (
            f"Заявка №{request_id} записана на {date_label}, {start}–{end}. "
            f"Инженера назначит диспетчер"
        )
    try:
        from app.realtime.hub import hub

        if not started:
            hub.publish(
                "booking.created",
                region_id=payload.region_id,
                date=payload.date,
                data={"request_id": request_id, "window": payload.window},
            )
    except Exception:  # noqa: BLE001
        pass
    return BookingRequestOut(
        request_id=request_id,
        scenario_id=scenario.id,
        status="planned" if engineer_id else "unassigned",
        tentative_engineer_id=engineer_id or tentative,
        engineer_id=engineer_id,
        plan_id=plan_id,
        window=payload.window,
        message=message,
    )


def _embed_booking_event(repository, engine, active_plan, scenario, request: dict):
    """Встраивает запись в начатый день событием ``order_added`` (п. 17)."""
    from app.core.timeutils import now_hhmm, today_str
    from app.schemas.request import RequestIn
    from app.services.day_clock import scenario_clock

    clean = {
        key: value
        for key, value in request.items()
        if not key.startswith("_") and key not in {"status"}
    }
    # «сейчас» по живым часам — только для сегодняшнего дня; в будущем дне ничего не замораживаем (как в слотах)
    day = (scenario.scenario_metadata or {}).get("date")
    event_time = scenario_clock(scenario) or (now_hhmm() if day == today_str() else None)
    event = ApplyEventRequest(
        type="order_added",
        plan_id=active_plan.id,
        event_time=event_time,
        source="operator",
        request=RequestIn(**clean),
        apply=True,
    )
    computation = engine.apply(active_plan, event)
    _, plan, _ = persist_replan(
        repository,
        active_plan,
        computation,
        event_type="order_added",
        event_payload=computation.applied_event,
        status="applied",
    )
    scenario.requests = list(scenario.requests) + [request]
    repository.update_scenario(scenario)
    engineer_id = next(
        (
            item["engineer_id"]
            for item in (plan.result or {}).get("assignments", [])
            if item["request_id"] == request["id"]
        ),
        None,
    )
    return plan.id, engineer_id


def _ru_date(value: str) -> str:
    """YYYY-MM-DD → DD.MM."""
    try:
        year, month, day = value.split("-")
        return f"{day}.{month}"
    except ValueError:
        return value


def _recalc_after_change(repository: Repository, planner, scenario, request_id: str):
    """Пересчитывает день после изменения записи (D-18)."""
    from app.core.timeutils import now_hhmm

    plans = repository.list_plans(scenario_id=scenario.id, limit=200)
    started = any(p.status == "applied" for p in plans)
    active_requests = [
        item
        for item in scenario.requests
        if item.get("status") not in {"cancelled", "rescheduled"}
    ]
    if not active_requests:
        # В дне не осталось активных заявок — план не считаем (п. 39). Черновик с ушедшей
        # заявкой тоже гасим: иначе она остаётся у бригады и в поиске «Запланирована».
        for plan in plans:
            if plan.status in {"applied", "draft"}:
                plan.status = "superseded"
        repository.session.commit()
        metadata = dict(scenario.scenario_metadata or {})
        metadata.pop("draft_plan_id", None)
        metadata["last_recalc"] = {"at": now_hhmm(), "request_id": request_id}
        scenario.scenario_metadata = metadata
        repository.update_scenario(scenario)
        return None, "empty", None, 0
    computation = planner.compute(
        scenario.engineers, active_requests, include_baseline=False, time_limit=4.0
    )
    if started:
        for plan in plans:
            if plan.status == "applied":
                plan.status = "superseded"
        repository.session.commit()
    version = max(
        (int((p.algorithm_meta or {}).get("version", 0) or 0) for p in plans), default=0
    ) + 1
    report = computation.report
    meta = {
        "solver": "hybrid_v2",
        "seed": 42,
        "elapsed_seconds": round(float(computation.algorithm_meta.get("elapsed_seconds") or 0.0), 3),
        "road_factor": computation.problem.road_factor,
        "matrix_sources": computation.problem.matrix_sources,
        "warnings": computation.problem.warnings,
        "strategy": "ours",
        "version": version,
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
        algorithm_meta=meta,
        kind="optimized",
        status="applied" if started else "draft",
    )
    engineer_id = next(
        (
            item["engineer_id"]
            for item in computation.api_result.get("assignments", [])
            if item["request_id"] == request_id
        ),
        None,
    )
    metadata = dict(scenario.scenario_metadata or {})
    metadata["last_recalc"] = {"at": now_hhmm(), "request_id": request_id}
    if started:
        metadata["active_plan_id"] = plan.id
    else:
        metadata["draft_plan_id"] = plan.id
    scenario.scenario_metadata = metadata
    repository.update_scenario(scenario)
    return plan.id, ("applied" if started else "draft"), engineer_id, version


@router.post(
    "/requests/{request_id}/cancel",
    summary="Отменить запись",
)
def cancel_booking_request(
    request_id: str,
    payload: BookingCancelIn,
    region_id: str | None = None,
    date: str | None = None,
    repository: Repository = Depends(get_repository),
    planner=Depends(get_planner_service),
    engine=Depends(get_replan_engine),
) -> dict:
    """Отменяет запись. В начатом дне — предложением диспетчеру (п. 16, 35, 39)."""
    scenario, request = _find_request(repository, request_id, region_id, date)
    _guard_operator_mutation(_request_status(repository, scenario, request))
    if payload.reason == "other" and not payload.comment:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"error": {"code": "COMMENT_REQUIRED", "message": "Для причины 'other' нужен comment"}},
        )
    active, started = _days_plan(repository, scenario)
    if started and active is not None:
        plan_id = _embed_cancel_event(repository, engine, active, scenario, request, payload)
        return {
            "request_id": request_id,
            "status": "cancel_pending",
            "plan_id": plan_id,
            "message": "Заявка отменена. Чем занять освободившееся окно, решит диспетчер",
        }
    request["status"] = "cancelled"
    request["_cancel_reason"] = payload.reason
    if payload.comment:
        request["_cancel_comment"] = payload.comment
    repository.update_scenario(scenario)
    plan_id, state, _eng, _v = _recalc_after_change(repository, planner, scenario, request_id)
    date_label = _ru_date((scenario.scenario_metadata or {}).get("date", ""))
    try:
        from app.realtime.hub import hub

        meta = scenario.scenario_metadata or {}
        hub.publish(
            "booking.cancelled",
            region_id=meta.get("region_id"),
            date=meta.get("date"),
            data={"request_id": request_id},
        )
    except Exception:  # noqa: BLE001
        pass
    if state == "draft":
        message = f"Заявка отменена. План на {date_label} пересчитан"
    else:
        message = "Заявка отменена. Чем занять освободившееся окно, решит диспетчер"
    return {"request_id": request_id, "status": "cancelled", "plan_id": plan_id, "message": message}


def _embed_cancel_event(repository, engine, active_plan, scenario, request: dict, payload) -> str:
    """Создаёт предложение ``order_cancelled`` для начатого дня (п. 16, 35, 39)."""
    from app.core.timeutils import now_hhmm, today_str
    from app.services.day_clock import scenario_clock

    # «сейчас» по живым часам — только для сегодняшнего дня; в будущем дне ничего не замораживаем (как в слотах)
    day = (scenario.scenario_metadata or {}).get("date")
    event_time = scenario_clock(scenario) or (now_hhmm() if day == today_str() else None)
    previous_status = request.get("status", "planned")
    params = {
        "reason": payload.reason,
        "comment": payload.comment,
        "stage": "operator",
        "previous_status": previous_status,
    }
    event = ApplyEventRequest(
        type="order_cancelled",
        plan_id=active_plan.id,
        event_time=event_time,
        source="operator",
        order_id=request["id"],
        apply=False,
        params=params,
    )
    computation = engine.apply(active_plan, event)
    _, plan, _ = persist_replan(
        repository,
        active_plan,
        computation,
        event_type="order_cancelled",
        event_payload=computation.applied_event,
        status="proposed",
    )
    request["status"] = "cancel_pending"
    request["_cancel_reason"] = payload.reason
    request["_operator_previous_status"] = previous_status
    repository.update_scenario(scenario)
    return plan.id


def _embed_window_event(repository, engine, active_plan, scenario, request: dict, window: str) -> str:
    """Смена окна той же заявки в начатом дне — предложение ``order_window_changed`` (п. 39)."""
    from app.core.timeutils import now_hhmm, today_str
    from app.services.day_clock import scenario_clock

    start, end = window.split("-")
    # «сейчас» по живым часам — только для сегодняшнего дня; в будущем дне ничего не замораживаем (как в слотах)
    day = (scenario.scenario_metadata or {}).get("date")
    event_time = scenario_clock(scenario) or (now_hhmm() if day == today_str() else None)
    previous_status = request.get("status", "planned")
    event = ApplyEventRequest(
        type="order_window_changed",
        plan_id=active_plan.id,
        event_time=event_time,
        source="operator",
        order_id=request["id"],
        apply=False,
        params={"window_start": start, "window_end": end, "previous_status": previous_status},
    )
    computation = engine.apply(active_plan, event)
    _, plan, _ = persist_replan(
        repository,
        active_plan,
        computation,
        event_type="order_window_changed",
        event_payload=computation.applied_event,
        status="proposed",
    )
    request["status"] = "reschedule_pending"
    request["_operator_previous_status"] = previous_status
    request["_rescheduled_to"] = {"date": (scenario.scenario_metadata or {}).get("date"), "window": window}
    repository.update_scenario(scenario)
    return plan.id


def _guard_operator_mutation(status_value: str | None) -> None:
    """Запрещает отмену/перенос в недопустимых статусах (9.9, п. 35)."""
    messages = {
        "done": "Заявка уже выполнена — отменить или перенести нельзя",
        "cancelled": "Заявка уже отменена",
        "rescheduled": "Заявка уже перенесена",
        "cancel_pending": "По заявке ждёт решения диспетчер",
        "reschedule_pending": "По заявке ждёт решения диспетчер",
    }
    if status_value in messages:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"error": {"code": "ILLEGAL_TRANSITION", "message": messages[status_value]}},
        )


#: Статусы записи, которые план не перекрывает: решение уже принято или ждёт диспетчера (п. 39).
STICKY_STATUSES = {"cancelled", "rescheduled", "cancel_pending", "reschedule_pending"}


def _request_status(repository: Repository, scenario, request: dict) -> str:
    """Статус заявки как в поиске: решение по записи, иначе по действующему плану (п. 35, 39)."""
    from app.services.day_plan import active_plan

    if request.get("status") in STICKY_STATUSES:
        return request["status"]
    plan = active_plan(repository, scenario)
    if plan is not None:
        for route in (plan.result or {}).get("routes", []):
            for point in route.get("route", []):
                if point.get("request_id") == request.get("id"):
                    return point.get("status", "planned")
    return request.get("status", "planned")


@router.post(
    "/requests/{request_id}/reschedule",
    summary="Перенести запись",
)
def reschedule_booking_request(
    request_id: str,
    payload: BookingRescheduleIn,
    region_id: str | None = None,
    date: str | None = None,
    repository: Repository = Depends(get_repository),
    planner=Depends(get_planner_service),
    engine=Depends(get_replan_engine),
) -> dict:
    """Переносит запись. Номер заявки сохраняется, копии не создаются (п. 40)."""
    scenario, request = _find_request(repository, request_id, region_id, date)
    _guard_operator_mutation(_request_status(repository, scenario, request))
    if payload.new_window not in WINDOWS:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Неизвестное окно")
    start, end = payload.new_window.split("-")
    meta = scenario.scenario_metadata or {}
    region_id = meta.get("region_id", "east")
    current_date = meta.get("date")
    active, started = _days_plan(repository, scenario)
    same_day = payload.new_date == current_date

    if started and active is not None:
        if same_day:
            plan_id = _embed_window_event(
                repository, engine, active, scenario, request, payload.new_window
            )
            return {
                "request_id": request_id,
                "status": "reschedule_pending",
                "new_date": payload.new_date,
                "new_window": payload.new_window,
                "new_request_id": request_id,
                "plan_id": plan_id,
                "date": payload.new_date,
                "window": payload.new_window,
                "message": f"Перенос №{request_id} на {payload.new_window} ждёт решения диспетчера",
            }
        # Другой день в начатом дне: предложение отмены; цель встанет после «Принять».
        from app.core.timeutils import now_hhmm
        from app.services.day_clock import scenario_clock

        previous_status = request.get("status", "planned")
        event = ApplyEventRequest(
            type="order_cancelled",
            plan_id=active.id,
            event_time=scenario_clock(scenario) or now_hhmm(),
            source="operator",
            order_id=request_id,
            apply=False,
            params={
                "reason": "booking_error",
                "comment": "перенос",
                "stage": "operator",
                "previous_status": previous_status,
                "rescheduled_to": {"date": payload.new_date, "window": payload.new_window},
            },
        )
        computation = engine.apply(active, event)
        _, plan, _ = persist_replan(
            repository,
            active,
            computation,
            event_type="order_cancelled",
            event_payload=computation.applied_event,
            status="proposed",
        )
        request["status"] = "reschedule_pending"
        request["_operator_previous_status"] = previous_status
        request["_rescheduled_to"] = {"date": payload.new_date, "window": payload.new_window}
        repository.update_scenario(scenario)
        return {
            "request_id": request_id,
            "status": "reschedule_pending",
            "new_date": payload.new_date,
            "new_window": payload.new_window,
            "new_request_id": request_id,
            "plan_id": plan.id,
            "date": payload.new_date,
            "window": payload.new_window,
            "message": f"Перенос №{request_id} на {_ru_date(payload.new_date)} ждёт решения диспетчера",
        }

    if same_day:
        request["window_start"], request["window_end"] = start, end
        request["_rescheduled_to"] = {"date": payload.new_date, "window": payload.new_window}
        repository.update_scenario(scenario)
        plan_id, _state, _eng, _v = _recalc_after_change(repository, planner, scenario, request_id)
        try:
            from app.realtime.hub import hub

            meta = scenario.scenario_metadata or {}
            hub.publish(
                "booking.rescheduled",
                region_id=meta.get("region_id"),
                date=meta.get("date"),
                data={"request_id": request_id, "new_date": payload.new_date, "new_window": payload.new_window},
            )
        except Exception:  # noqa: BLE001
            pass
        return {
            "request_id": request_id,
            "status": "rescheduled",
            "new_date": payload.new_date,
            "new_window": payload.new_window,
            "new_request_id": request_id,
            "plan_id": plan_id,
            "date": payload.new_date,
            "window": payload.new_window,
            "message": f"Заявка №{request_id} перенесена на {payload.new_window}",
        }

    # Другой день, день не начат: переносим ту же запись в целевой день.
    request["status"] = "rescheduled"
    request["_rescheduled_to"] = {"date": payload.new_date, "window": payload.new_window}
    repository.update_scenario(scenario)
    _recalc_after_change(repository, planner, scenario, request_id)
    target_plan = move_to_day(
        repository, planner, engine, request, region_id, current_date,
        {"date": payload.new_date, "window": payload.new_window},
    )
    try:
        from app.realtime.hub import hub

        hub.publish(
            "booking.rescheduled",
            region_id=region_id,
            date=current_date,
            data={"request_id": request_id, "new_date": payload.new_date, "new_window": payload.new_window},
        )
    except Exception:  # noqa: BLE001
        pass
    return {
        "request_id": request_id,
        "status": "rescheduled",
        "new_date": payload.new_date,
        "new_window": payload.new_window,
        "new_request_id": request_id,
        "plan_id": target_plan,
        "date": payload.new_date,
        "window": payload.new_window,
        "message": f"Заявка №{request_id} перенесена на {_ru_date(payload.new_date)}, {payload.new_window}",
    }


def move_to_day(repository: Repository, planner, engine, request: dict, region_id: str, from_date: str | None, to: dict):
    """Ставит ту же запись в целевой день (п. 39, 40): новое окно, пересчёт или встраивание."""
    start, end = to["window"].split("-")
    target = _get_or_create_scenario(repository, region_id, to["date"])
    moved = copy.deepcopy(request)
    for key in ("_operator_previous_status", "_rescheduled_to", "_cancel_reason", "_cancel_comment"):
        moved.pop(key, None)
    moved["window_start"], moved["window_end"] = start, end
    moved["status"] = "planned"
    moved["_rescheduled_from"] = {"date": from_date, "request_id": request["id"]}
    target.requests = list(target.requests) + [moved]
    repository.update_scenario(target)
    target_active, target_started = _days_plan(repository, target)
    if target_started and target_active is not None:
        target_plan, _eng = _embed_booking_event(repository, engine, target_active, target, moved)
    else:
        target_plan, _state, _eng, _v = _recalc_after_change(repository, planner, target, moved["id"])
    return target_plan


@router.get(
    "/requests",
    summary="Поиск записей оператора",
)
def search_booking_requests(
    q: str | None = None,
    region_id: str | None = None,
    date: str | None = None,
    repository: Repository = Depends(get_repository),
) -> list[dict]:
    """Поиск по дню региона (не только по записям оператора), статус — по плану (п. 16)."""
    from app.services.day_plan import active_plan, day_plan

    results: list[dict] = []
    needle = (q or "").strip().lower()
    # Русские «ВК» → латинские «BK» и поиск по вхождению, не только по началу (п. 42).
    normalized = needle.replace("вк", "bk")
    for scenario in repository.find_scenarios(region_id=region_id, date=date, limit=200):
        meta = scenario.scenario_metadata or {}
        if meta.get("derived_from_scenario") or meta.get("archived"):
            continue
        plan = active_plan(repository, scenario) or day_plan(repository, scenario)
        requests = list(scenario.requests)
        known = {item["id"] for item in requests}
        engineer_by_request: dict[str, str] = {}
        status_by_request: dict[str, str] = {}
        if plan is not None:
            for item in (plan.input_payload or {}).get("requests", []):
                if item["id"] not in known:
                    requests.append(item)
                    known.add(item["id"])
            for route in (plan.result or {}).get("routes", []):
                for point in route.get("route", []):
                    engineer_by_request[point["request_id"]] = route["engineer_id"]
                    status_by_request[point["request_id"]] = point.get("status", "planned")
            for item in (plan.result or {}).get("unassigned", []):
                rid = item.get("request_id") or item.get("task_id")
                if rid:
                    status_by_request[rid] = "unassigned"
        for request in requests:
            request_id_lower = request["id"].lower()
            if needle and not (
                needle in request_id_lower
                or normalized in request_id_lower
                or needle in (request.get("address") or "").lower()
            ):
                continue
            engineer_id = engineer_by_request.get(request["id"])
            engineer_name = next(
                (
                    item.get("name")
                    for item in scenario.engineers
                    if item["id"] == engineer_id
                ),
                None,
            )
            results.append(
                {
                    "request_id": request["id"],
                    "region_id": meta.get("region_id"),
                    "date": meta.get("date"),
                    "window": f"{request.get('window_start')}-{request.get('window_end')}",
                    "address": request.get("address"),
                    "type_bk": request.get("type_bk"),
                    "type_hd": request.get("type_hd"),
                    "status": request.get("status")
                    if request.get("status") in STICKY_STATUSES
                    else status_by_request.get(request["id"], request.get("status")),
                    "district": request.get("district"),
                    "gigabit": bool(request.get("gigabit")),
                    "technology": request.get("technology"),
                    "required_transport": request.get("required_transport"),
                    "engineer_name": engineer_name,
                }
            )
            if len(results) >= 20:
                return results
    return results


def _find_request(
    repository: Repository,
    request_id: str,
    region_id: str | None = None,
    date: str | None = None,
):
    """Ищет заявку в дне ``region_id``/``date`` (п. 35), иначе по живым дням.

    Архивные и производные сценарии пропускаются.
    """
    from app.services.day_plan import active_plan

    def _search(scenario):
        for request in scenario.requests:
            if request["id"] == request_id:
                return request
        plan = active_plan(repository, scenario)
        if plan is not None:
            for request in (plan.input_payload or {}).get("requests", []):
                if request["id"] == request_id:
                    return request
        return None

    if region_id and date:
        scenario = _find_scenario(repository, region_id, date)
        if scenario is not None:
            found = _search(scenario)
            if found is not None:
                return scenario, found
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Заявка не найдена")

    for scenario in repository.list_scenarios(limit=300):
        meta = scenario.scenario_metadata or {}
        if meta.get("derived_from_scenario") or meta.get("archived"):
            continue
        found = _search(scenario)
        if found is not None:
            return scenario, found
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Заявка не найдена")

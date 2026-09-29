"""Экран инженера: день и нажатия (факты и предложения)."""
from __future__ import annotations

from fastapi import Security, APIRouter, Depends, HTTPException, status

from app.api.deps import (
    get_current_user,
    get_ors_client,
    get_replan_engine,
    get_repository,
    verify_token,
)
from app.schemas.event import ApplyEventRequest
from app.schemas.extras import (
    EngineerActionIn,
    EngineerActionOut,
    EngineerDayResponse,
    EngineerVisit,
)
from app.services.ors_client import OpenRouteServiceClient
from app.services.plan_persistence import persist_replan
from app.storage.repository import Repository

router = APIRouter(prefix="/engineers", tags=["Инженер"], dependencies=[Security(verify_token)])

#: Допустимые переходы статусов заявки для фактов.
_FACT_TRANSITIONS = {
    "en_route": {"planned"},
    "start": {"en_route"},
    "complete": {"in_progress"},
}


def _resolve_scenario(repository: Repository, engineer_id: str, scenario_id: str | None):
    if scenario_id:
        scenario = repository.get_scenario(scenario_id)
        if scenario is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Сценарий не найден")
        return scenario
    for scenario in repository.list_scenarios(limit=300):
        if any(item["id"] == engineer_id for item in scenario.engineers):
            return scenario
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Инженер не найден")


def _latest_plan(repository: Repository, scenario_id: str):
    """Действующий план дня: active/draft по метаданным, иначе последний."""
    scenario = repository.get_scenario(scenario_id)
    if scenario is not None:
        from app.services.day_plan import day_plan

        plan = day_plan(repository, scenario)
        if plan is not None:
            return plan
    plans = repository.list_plans(scenario_id=scenario_id, limit=1)
    return plans[0] if plans else None


def _requests_index(scenario, plan) -> dict:
    """Заявки сценария + заявки действующей версии (новые/срочные из событий)."""
    index = {item["id"]: item for item in scenario.requests}
    if plan is not None:
        for item in (plan.input_payload or {}).get("requests", []):
            index.setdefault(item["id"], item)
    return index


def _find_request(scenario, request_id: str | None):
    if not request_id:
        return None
    return next((item for item in scenario.requests if item["id"] == request_id), None)


def _find_request_in(index: dict, request_id: str | None):
    if not request_id:
        return None
    return index.get(request_id)


def _build_day(scenario, engineer: dict, plan, requests_index: dict | None = None) -> EngineerDayResponse:
    visits: list[EngineerVisit] = []
    requests = requests_index if requests_index is not None else _requests_index(scenario, plan)
    if plan is not None:
        for route in (plan.result or {}).get("routes", []):
            if route["engineer_id"] != engineer["id"]:
                continue
            for point in route.get("route", []):
                request = requests.get(point["request_id"]) or {}
                visits.append(
                    EngineerVisit(
                        request_id=point["request_id"],
                        sequence=point["sequence"],
                        status=point.get("status", "planned"),
                        flags=list(point.get("flags", [])),
                        type_bk=request.get("type_bk"),
                        type_hd=request.get("type_hd"),
                        address=point.get("address") or request.get("address"),
                        district=request.get("district"),
                        window=f"{point['window_start']}-{point['window_end']}",
                        arrival=point.get("arrival"),
                        start=point.get("start"),
                        actual_start=point.get("actual_start"),
                        actual_end=point.get("actual_end"),
                        duration_minutes=request.get("duration_minutes", 0),
                        leg_km=point.get("leg_distance_km", 0.0),
                        gigabit=bool(request.get("gigabit")),
                        technology=request.get("technology"),
                        equipment=dict(request.get("equipment") or {}),
                        why_you=(
                            f"Навык — {point.get('required_skill_display', '')}; "
                            f"окно {point['window_start']}–{point['window_end']}."
                        ),
                    )
                )
    done = sum(1 for visit in visits if visit.status == "done")
    first_start = visits[0].start if visits else None
    banners = _build_banners(plan, engineer["id"])
    return EngineerDayResponse(
        engineer={
            "id": engineer["id"],
            "name": engineer.get("name", engineer["id"]),
            "transport": engineer["transport"],
            "actual_transport": engineer.get("actual_transport"),
            "shift_start": engineer["shift_start"],
            "shift_end": engineer["shift_end"],
            "shift_status": engineer.get("shift_status", "not_started"),
            "start": {"kind": engineer.get("start_kind", "office")},
        },
        summary={
            "total": len(visits),
            "done": done,
            "km_planned": round(sum(v.leg_km for v in visits), 3),
            "first_start": first_start,
        },
        active_request_id=next(
            (v.request_id for v in visits if v.status in {"en_route", "in_progress"}), None
        ),
        visits=visits,
        banners=banners,
    )


def _local_hhmm(value) -> str:
    """Время в часовом поясе сервиса (БД хранит UTC) — п. 22."""
    if value is None:
        return ""
    from datetime import timezone

    from app.core.timeutils import tzinfo

    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(tzinfo()).strftime("%H:%M")


def _build_banners(plan, engineer_id: str) -> list[dict]:
    """Баннеры инженеру по изменениям применённого плана (D-31, п. 52)."""
    if plan is None or plan.status != "applied" or not plan.parent_plan_id:
        return []
    at = _local_hhmm(plan.created_at)
    status_by_request: dict[str, str] = {}
    for route in (plan.result or {}).get("routes", []):
        for point in route.get("route", []):
            status_by_request[point.get("request_id")] = point.get("status", "planned")
    banners: list[dict] = []
    for change in (plan.result or {}).get("changes", []):
        kind = change.get("kind")
        before = change.get("before") or [None, None]
        after = change.get("after") or [None, None]
        if engineer_id not in {before[0], after[0]}:
            continue
        task_id = change.get("task_id")
        status = status_by_request.get(task_id, "planned")
        if status in {"done", "cancelled"}:
            # По закрытым заявкам баннеры не нужны (п. 52).
            continue
        if kind == "newly_assigned":
            banners.append({"type": "new_urgent", "text": f"Новая заявка №{task_id} — после текущей",
                            "at": at, "request_id": task_id})
        elif kind == "reassigned" and before[0] == engineer_id:
            banners.append({"type": "reassigned", "text": f"Заявка №{task_id} передана другому инженеру",
                            "at": at, "request_id": task_id})
        elif kind == "reassigned" and after[0] == engineer_id:
            banners.append({"type": "reassigned_in", "text": f"Новая заявка №{task_id} — вам передали",
                            "at": at, "request_id": task_id})
        elif kind == "position_changed" and after[0] == engineer_id:
            # Позиция с 1, как в маршруте (п. 52).
            banners.append({"type": "order_changed",
                            "text": f"Порядок изменён: №{task_id} теперь {int(after[1]) + 1}-я",
                            "at": at, "request_id": task_id})
    return banners


# --- Инженер «от себя» (D-21, D-23): /engineers/me/* ------------------------
def _me_scenario(repository: Repository, user):
    """День инженера: регион из токена, сегодня, первый живой день (п. 32).

    Не ищем бригаду в чужих регионах и днях — иначе инженер Югоцентра открывал бы
    день Востока. Нет дня — 404 (после попытки лениво создать демо-день).
    """
    from app.core.timeutils import today_str

    if not user.engineer_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Токен не привязан к инженеру")
    region_id = (user.region_ids or [None])[0]

    def _find():
        for scenario in repository.find_scenarios(region_id=region_id, date=today_str(), limit=20):
            meta = scenario.scenario_metadata or {}
            if meta.get("archived"):
                continue
            if any(item["id"] == user.engineer_id for item in scenario.engineers):
                return scenario
        return None

    scenario = _find()
    # День из одних записей оператора превращаем в настоящий (п. 30).
    if region_id:
        from app.core.regions import is_builtin

        if is_builtin(region_id):
            from app.services.demo_seed import ensure_demo_day

            ensure_demo_day(repository, region_id, today_str())
            scenario = _find()
    if scenario is not None:
        return scenario
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="На сегодня дня нет")


def _me_engineer(scenario, engineer_id: str) -> dict:
    engineer = next((item for item in scenario.engineers if item["id"] == engineer_id), None)
    if engineer is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Инженер не найден в дне")
    return engineer


@router.get("/me/day", summary="День инженера (по токену)")
def me_day(
    repository: Repository = Depends(get_repository),
    user=Depends(get_current_user),
) -> dict:
    """День инженера по токену: визиты, флаги, статус публикации плана."""
    from app.core.timeutils import today_str

    scenario = _me_scenario(repository, user)
    engineer = _me_engineer(scenario, user.engineer_id)
    plan = _latest_plan(repository, scenario.id)
    day = _build_day(scenario, engineer, plan).model_dump()
    published = bool((scenario.scenario_metadata or {}).get("active_plan_id")) or (
        plan is not None and plan.status == "applied"
    )
    # Координаты точек для карты инженера.
    request_by_id = _requests_index(scenario, plan)
    for visit in day.get("visits", []):
        request = request_by_id.get(visit["request_id"], {})
        visit["lat"] = request.get("latitude")
        visit["lon"] = request.get("longitude")
    day["date"] = (scenario.scenario_metadata or {}).get("date") or today_str()
    day["plan_published"] = published
    from app.services.day_clock import scenario_clock

    day["clock"] = scenario_clock(scenario)
    ordered_ids = sorted(item["id"] for item in scenario.engineers)
    day["engineer"]["color_index"] = (
        ordered_ids.index(engineer["id"]) if engineer["id"] in ordered_ids else 0
    )
    day["shift_totals"] = (
        _shift_totals(day.get("visits", []), engineer)
        if engineer.get("shift_status") == "finished"
        else None
    )
    return day


def _shift_totals(visits: list[dict], engineer: dict) -> dict:
    """Итоги смены для завершённого дня."""
    done = sum(1 for v in visits if v.get("status") == "done")
    km = sum(float(v.get("leg_km") or 0.0) for v in visits)
    ended = max((v.get("actual_end") for v in visits if v.get("actual_end")), default=None)
    return {
        "done": done,
        "total": len(visits),
        "started_in_window": done,
        "km": round(km, 3),
        "minutes_travel": sum(int(v.get("travel_minutes") or 0) for v in visits),
        "minutes_work": 0,
        "minutes_wait": 0,
        "interrupted": 0,
        "started_at": engineer.get("shift_start"),
        "ended_at": ended or engineer.get("shift_end"),
    }


@router.post("/me/actions", response_model=EngineerActionOut, summary="Нажатие инженера (по токену)")
def me_action(
    payload: EngineerActionIn,
    repository: Repository = Depends(get_repository),
    engine=Depends(get_replan_engine),
    user=Depends(get_current_user),
) -> EngineerActionOut:
    """Действие инженера от своего имени (инженер определяется по токену)."""
    if not user.engineer_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Токен не привязан к инженеру")
    if payload.action == "fail":
        reason = (payload.payload or {}).get("reason")
        comment = (payload.payload or {}).get("comment")
        if reason == "other" and not comment:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={"error": {"code": "COMMENT_REQUIRED", "message": "Для причины 'other' нужен comment"}},
            )
    # Нажатие меняет ровно тот день, который отдаёт GET /engineers/me/day.
    scenario = _me_scenario(repository, user)
    return engineer_action(
        engineer_id=user.engineer_id,
        payload=payload,
        scenario_id=scenario.id,
        repository=repository,
        engine=engine,
    )


@router.get("/me/route", summary="Маршрут инженера по оставшимся точкам")
def me_route(
    remaining: bool = True,
    repository: Repository = Depends(get_repository),
    user=Depends(get_current_user),
    ors_client: OpenRouteServiceClient | None = Depends(get_ors_client),
) -> dict:
    """Маршрут по оставшимся заявкам: start — последняя выполненная, точки — в работе/плане."""
    scenario = _me_scenario(repository, user)
    engineer = _me_engineer(scenario, user.engineer_id)
    plan = _latest_plan(repository, scenario.id)
    request_by_id = _requests_index(scenario, plan)

    points: list[dict] = []
    last_done: dict | None = None
    if plan is not None:
        for route in (plan.result or {}).get("routes", []):
            if route["engineer_id"] != user.engineer_id:
                continue
            for point in route.get("route", []):
                state = point.get("status", "planned")
                if state == "done":
                    last_done = point
                elif state in {"planned", "en_route", "in_progress"}:
                    points.append(point)

    start = last_done["request_id"] if last_done else None
    start_coords = None
    if last_done:
        request = request_by_id.get(last_done["request_id"], {})
        start_coords = (request.get("latitude"), request.get("longitude"))
        label = f"{last_done['request_id']} (выполнена)"
    else:
        start_coords = (engineer["latitude"], engineer["longitude"])
        label = "старт смены"

    waypoints = [start_coords] if start_coords else []
    out_points = []
    for index, point in enumerate(points, start=1):
        request = request_by_id.get(point["request_id"], {})
        out_points.append(
            {
                "request_id": point["request_id"],
                # Номер визита в дне, а не пересчёт оставшихся (п. 34).
                "sequence": point.get("sequence", index),
                "lat": request.get("latitude"),
                "lon": request.get("longitude"),
                "address": request.get("address"),
            }
        )
        waypoints.append((request.get("latitude"), request.get("longitude")))

    transport = engineer.get("actual_transport") or engineer.get("transport")
    geometry = None
    if ors_client is not None and len([w for w in waypoints if w and w[0] is not None]) >= 2:
        valid = [w for w in waypoints if w and w[0] is not None]
        profile = ors_client.geometry_profile_for(transport)
        if profile:
            try:
                road = ors_client.route_geometry(valid, profile, transport=transport)
                geometry = {"type": "LineString", "coordinates": road.coordinates}
            except Exception:  # noqa: BLE001
                geometry = None
    if geometry is None:
        geometry = {
            "type": "LineString",
            "coordinates": [[lon, lat] for lat, lon in waypoints if lat is not None],
        }

    return {
        "transport": transport,
        "start": {"lat": start_coords[0] if start_coords else None,
                  "lon": start_coords[1] if start_coords else None,
                  "label": label},
        "points": out_points,
        "geometry": geometry,
    }


@router.get(
    "/{engineer_id}/day",
    response_model=EngineerDayResponse,
    summary="День инженера",
    responses={404: {"description": "Инженер/сценарий не найден"}},
)
def get_engineer_day(
    engineer_id: str,
    scenario_id: str | None = None,
    repository: Repository = Depends(get_repository),
) -> EngineerDayResponse:
    """Возвращает день инженера по последней версии плана."""
    scenario = _resolve_scenario(repository, engineer_id, scenario_id)
    engineer = next((item for item in scenario.engineers if item["id"] == engineer_id), None)
    if engineer is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Инженер не найден")
    return _build_day(scenario, engineer, _latest_plan(repository, scenario.id))


def _update_visit_status(plan, request_id: str, new_status: str, at: str | None) -> None:
    """Обновляет статус визита в сохранённом плане (факт применяется сразу)."""
    if plan is None:
        return
    result = plan.result or {}
    changed = False
    for route in result.get("routes", []):
        for point in route.get("route", []):
            if point["request_id"] == request_id:
                point["status"] = new_status
                if new_status == "en_route":
                    point["actual_arrival"] = at
                elif new_status == "in_progress":
                    point["actual_start"] = at
                elif new_status == "done":
                    point["actual_end"] = at
                changed = True
    if changed:
        plan.result = result


@router.post(
    "/{engineer_id}/actions",
    response_model=EngineerActionOut,
    summary="Нажатие инженера (факт/событие)",
)
def engineer_action(
    engineer_id: str,
    payload: EngineerActionIn,
    scenario_id: str | None = None,
    repository: Repository = Depends(get_repository),
    engine=Depends(get_replan_engine),
) -> EngineerActionOut:
    """Обрабатывает нажатие инженера."""
    scenario = _resolve_scenario(repository, engineer_id, scenario_id)
    engineer = next((item for item in scenario.engineers if item["id"] == engineer_id), None)
    if engineer is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Инженер не найден")
    plan = _latest_plan(repository, scenario.id)
    action = payload.action
    if payload.at:
        at = payload.at
    else:
        from app.services.day_clock import resolve_now

        at = resolve_now(repository, scenario.id)
    request = _find_request_in(_requests_index(scenario, plan), payload.request_id)
    event_id: str | None = None

    # Инцидент (D-31): сломался транспорт / не может продолжать / другое.
    if action == "incident":
        reason = payload.payload.get("reason")
        if reason == "transport_broken":
            new_transport = payload.payload.get("new_transport")
            if not new_transport:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail={"error": {"code": "TRANSPORT_REQUIRED", "message": "Укажите new_transport"}},
                )
            return engineer_action(
                engineer_id,
                EngineerActionIn(action="transport_changed", at=at, payload={"transport": new_transport}),
                scenario_id=scenario.id,
                repository=repository,
                engine=engine,
            )
        if reason == "cannot_continue":
            return engineer_action(
                engineer_id,
                EngineerActionIn(action="unavailable", at=at),
                scenario_id=scenario.id,
                repository=repository,
                engine=engine,
            )
        if reason == "other":
            comment = payload.payload.get("comment")
            if not comment:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail={"error": {"code": "COMMENT_REQUIRED", "message": "Для причины 'other' нужен comment"}},
                )
            repository.create_event(
                event_type="incident",
                payload={
                    "headline": f"Инцидент у инженера {engineer_id}: {comment}",
                    "source": "engineer",
                    "event_time": at,
                    "engineer_id": engineer_id,
                    "needs_decision": True,
                },
                plan_id=plan.id if plan else None,
                scenario_id=scenario.id,
                result_plan_id=None,
            )
            repository.create_engineer_action(
                engineer_id, "incident", scenario_id=scenario.id, at=at, payload=payload.payload
            )
            refreshed = repository.get_scenario(scenario.id)
            eng = next((i for i in refreshed.engineers if i["id"] == engineer_id), None)
            return EngineerActionOut(
                engineer_id=engineer_id, action="incident", status="accepted", event_id=None,
                request_id=None,
                day=_build_day(refreshed, eng, _latest_plan(repository, refreshed.id)) if eng else None,
            )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"error": {"code": "REASON_REQUIRED", "message": "Укажите reason инцидента"}},
        )

    if action in _FACT_TRANSITIONS:
        if request is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Заявка не найдена")
        current = request.get("status", "planned")
        if current not in _FACT_TRANSITIONS[action]:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "error": {
                        "code": "ILLEGAL_TRANSITION",
                        "message": f"Нельзя выполнить '{action}' из статуса '{current}'",
                        "details": {"request_id": request["id"], "status": current},
                    }
                },
            )
        new_status = {"en_route": "en_route", "start": "in_progress", "complete": "done"}[action]
        request["status"] = new_status
        _update_visit_status(plan, request["id"], new_status, at)
        if plan is not None:
            repository.save_plan(plan)
        repository.update_scenario(scenario)

    elif action == "shift_start":
        engineer["shift_status"] = "on_shift"
        transport = payload.payload.get("transport")
        if transport:
            engineer["actual_transport"] = transport
        repository.update_scenario(scenario)

    elif action == "shift_end":
        engineer["shift_status"] = "finished"
        engineer["available"] = False
        repository.update_scenario(scenario)
        # Завершившая смену бригада — вне расчётов (п. 51): переносим в снимок плана.
        if plan is not None:
            engineers = list((plan.input_payload or {}).get("engineers", []))
            for item in engineers:
                if item.get("id") == engineer_id:
                    item["available"] = False
            payload_in = dict(plan.input_payload or {})
            payload_in["engineers"] = engineers
            plan.input_payload = payload_in
            repository.save_plan(plan)

    elif action in {"fail", "delay", "unavailable", "transport_changed"}:
        if plan is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Нет активного плана для перепланирования",
            )
        reason = payload.payload.get("reason")
        if action == "fail":
            valid_reasons = {"client_refused", "no_access", "technical", "client_reschedule", "other"}
            if reason not in valid_reasons:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail={"error": {"code": "REASON_REQUIRED", "message": "Укажите причину из справочника"}},
                )
            if reason == "other" and not payload.payload.get("comment"):
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail={"error": {"code": "COMMENT_REQUIRED", "message": "Для причины 'other' нужен comment"}},
                )
            if reason == "client_reschedule" and not payload.payload.get("desired_date"):
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail={"error": {"code": "DESIRED_DATE_REQUIRED", "message": "Для переноса нужен desired_date"}},
                )
            # Заявка уходит из активных сразу (D-32): статус и в сценарии, и в
            # точке плана, иначе /me/day отдаёт её текущей (п. 13).
            if request is not None:
                new_status = (
                    "reschedule_pending" if reason == "client_reschedule" else "cancel_pending"
                )
                previous_status = request.get("status", "planned")
                request["status"] = new_status
                _update_visit_status(plan, request["id"], new_status, at)
                repository.save_plan(plan)
                repository.update_scenario(scenario)
            else:
                previous_status = None
            event = ApplyEventRequest(
                type="order_cancelled",
                plan_id=plan.id,
                event_time=at,
                source="engineer",
                order_id=payload.request_id,
                apply=False,
                params={
                    "reason": reason,
                    "comment": payload.payload.get("comment"),
                    "stage": "on_site",
                    "previous_status": previous_status,
                },
            )
        elif action == "delay":
            event = ApplyEventRequest(
                type="engineer_delayed",
                plan_id=plan.id,
                event_time=at,
                source="engineer",
                engineer_id=engineer_id,
                params={"delay_min": int(payload.payload.get("minutes", 15))},
            )
        elif action == "transport_changed":
            event = ApplyEventRequest(
                type="transport_changed",
                plan_id=plan.id,
                event_time=at,
                source="engineer",
                engineer_id=engineer_id,
                params={"transport": payload.payload.get("transport")},
            )
        else:
            event = ApplyEventRequest(
                type="engineer_unavailable",
                plan_id=plan.id,
                event_time=at,
                source="engineer",
                engineer_id=engineer_id,
                params={"from": at, "to": None, "finish_current": True},
            )
        try:
            computation = engine.apply(plan, event)
            record, new_plan, _ = persist_replan(
                repository,
                plan,
                computation,
                event_type=event.type,
                event_payload=computation.applied_event,
                status="proposed",
            )
            event_id = record.id
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    else:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Неизвестное действие")

    repository.create_engineer_action(
        engineer_id,
        action,
        scenario_id=scenario.id,
        request_id=payload.request_id,
        at=at,
        payload=payload.payload,
        result_event_id=event_id,
    )
    # Факт инженера — в общую ленту дня (D-31).
    action_headlines = {
        "shift_start": f"Инженер {engineer_id} начал смену",
        "en_route": f"Инженер {engineer_id} в пути к №{payload.request_id}",
        "start": f"Инженер {engineer_id} начал работу по №{payload.request_id}",
        "complete": f"Инженер {engineer_id} выполнил №{payload.request_id}",
        "fail": f"Инженер {engineer_id}: проблема по №{payload.request_id}",
        "delay": f"Инженер {engineer_id} задерживается",
        "unavailable": f"Инженер {engineer_id} недоступен",
        "shift_end": f"Инженер {engineer_id} завершил смену",
    }
    repository.create_event(
        event_type="engineer_action",
        payload={
            "headline": action_headlines.get(action, f"Действие инженера {engineer_id}: {action}"),
            "source": "engineer",
            "event_time": at,
            "action": action,
            "request_id": payload.request_id,
            "engineer_id": engineer_id,
            "status": (request or {}).get("status"),
        },
        plan_id=plan.id if plan else None,
        scenario_id=scenario.id,
        result_plan_id=None,
    )
    # Живые обновления: нажатие инженера и статус заявки (§38).
    try:
        from app.realtime.hub import hub

        meta = scenario.scenario_metadata or {}
        hub.publish(
            "engineer.action",
            region_id=meta.get("region_id"),
            date=meta.get("date"),
            data={
                "engineer_id": engineer_id,
                "action": action,
                "request_id": payload.request_id,
            },
        )
        if payload.request_id and action in {"en_route", "start", "complete"}:
            hub.publish(
                "request.status_changed",
                region_id=meta.get("region_id"),
                date=meta.get("date"),
                data={
                    "request_id": payload.request_id,
                    "status": (request or {}).get("status"),
                    "engineer_id": engineer_id,
                },
            )
    except Exception:  # noqa: BLE001
        pass
    refreshed = repository.get_scenario(scenario.id)
    engineer = next((item for item in refreshed.engineers if item["id"] == engineer_id), None)
    return EngineerActionOut(
        engineer_id=engineer_id,
        action=action,
        status="accepted",
        event_id=event_id,
        request_id=payload.request_id,
        day=_build_day(refreshed, engineer, _latest_plan(repository, refreshed.id)) if engineer else None,
    )

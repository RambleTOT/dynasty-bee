"""Маршруты перепланирования: применение событий и журнал."""
from __future__ import annotations

from fastapi import Security, APIRouter, Depends, HTTPException, status

from app.api.deps import verify_token, get_current_user, get_ors_client, get_replan_engine, get_repository
from app.api.responses import error_responses
from app.core.timeutils import now_hhmm
from app.schemas.common import MessageResponse
from app.schemas.event import ApplyEventRequest, EventItem, ReplanResult, default_apply
from app.services.algorithm_adapter import AlgorithmError
from app.services.metrics_service import summarize_changes
from app.services.ors_client import OpenRouteServiceClient
from app.services.plan_persistence import persist_replan
from app.services.plan_presenter import plan_to_response
from app.services.replan_engine import canonical_type
from app.storage.repository import Repository

router = APIRouter(prefix="/events", tags=["События"], dependencies=[Security(verify_token)])

_APPLY_DESCRIPTION = """
Применяет **одно событие рабочего дня** и возвращает новую версию плана.

Поддерживаются все сценарии S1–S14: срочная заявка, отмена, недоступность/
возврат инженера, новая обычная заявка, задержка, раннее завершение, смена
транспорта, перенос окна, смена объёма работ, ручное переназначение,
продление смены, сдвиг окон.

Поведение:
* прошлое (выполненные/текущие визиты) **замораживается**, перестраивается
  только будущее (rolling horizon);
* если передана `telemetry`, состояния инженеров берутся из неё, иначе
  выводятся из плана и `time`;
* `apply=false` создаёт версию со статусом `proposed` (принять через
  `POST /planning/{plan_id}/apply`).
"""


def _geocode_request(repository: Repository, request, office: dict | None = None) -> None:
    """Дополняет заявку координатами: геокодер → офис (п. 15, 46)."""
    if request.latitude is not None:
        return
    if request.address:
        from app.core.config import get_settings
        from app.services.geocoder import Geocoder

        geocoder = Geocoder(repository, get_settings())
        coords = geocoder.geocode(request.address) if geocoder.provider != "none" else None
        if coords is not None:
            request.latitude, request.longitude = coords
            return
    # Не нашли адрес — ставим точку офиса, чтобы день не ломался (п. 46).
    if office:
        request.latitude = office.get("lat")
        request.longitude = office.get("lon")


def _resolve_plan(repository: Repository, plan_id: str | None):
    """Возвращает план по ID или последний сохранённый."""
    if plan_id:
        plan = repository.get_plan(plan_id)
        if plan is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="План не найден")
        return plan
    plans = repository.list_plans(limit=1)
    if not plans:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Нет сохранённых планов. Сначала выполните планирование",
        )
    return plans[0]


def _resolve_operator_plan(repository, user, payload):
    """Активный план региона для аварии оператора (D-33): без plan_id."""
    from app.core.regions import get_region, is_builtin
    from app.core.timeutils import today_str
    from app.services.day_clock import scenario_clock

    region_id = (payload.params or {}).get("region_id")
    if not region_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"error": {"code": "REGION_REQUIRED", "message": "Оператору нужно указать params.region_id"}},
        )
    # свои участки (§14) открыты всем операторам: в токене только участки кейса
    if (
        user is not None
        and getattr(user, "region_ids", None)
        and region_id not in user.region_ids
        and is_builtin(region_id)
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"error": {"code": "FORBIDDEN", "message": "Регион недоступен оператору"}},
        )
    date = today_str()
    from app.services import day_plan as day_plan_service

    def _find_active():
        for scenario in repository.find_scenarios(region_id=region_id, date=date, limit=50):
            applied = day_plan_service.active_plan(repository, scenario)
            if applied is not None:
                return scenario, applied
        return None, None

    scenario, applied = _find_active()
    if applied is None:
        # Лениво создаём демо-день региона на сегодня (п. 18).
        from app.services.demo_seed import ensure_demo_day

        if ensure_demo_day(repository, region_id, date):
            scenario, applied = _find_active()
    if applied is not None:
        event_time = scenario_clock(scenario) or now_hhmm()
        payload.event_time = event_time
        if payload.request is not None:
            payload.request.window_start = event_time
            payload.request.window_end = max(
                (item["shift_end"] for item in scenario.engineers), default="22:00"
            )
        return applied
    name = (get_region(region_id, repository) or {}).get("name", region_id)
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={
            "error": {
                "code": "DAY_NOT_STARTED",
                "message": f"Рабочий день в регионе {name} ещё не начат — аварию примет диспетчер",
            }
        },
    )


def _apply_event_impl(
    payload: ApplyEventRequest,
    repository: Repository,
    engine,
    ors_client: OpenRouteServiceClient | None,
    user=None,
) -> ReplanResult:
    """Общая реализация применения события (используется /apply и /replan)."""
    canonical = canonical_type(payload.type)
    # Оператор: авария без plan_id — план берём из активного дня региона (D-33).
    if (
        user is not None
        and getattr(user, "role", "") == "operator"
        and canonical == "urgent_order_added"
    ):
        base_plan = _resolve_operator_plan(repository, user, payload)
    else:
        base_plan = _resolve_plan(repository, payload.plan_id)
    if not base_plan.input_payload:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="В исходном плане нет входных данных для перепланирования",
        )
    # Оператору разрешена только срочная заявка (D-17).
    if user is not None and getattr(user, "role", "") == "operator" and canonical != "urgent_order_added":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"error": {"code": "FORBIDDEN", "message": "Оператор может создавать только срочные заявки"}},
        )
    # Дубликат новой заявки — конфликт (ТЗ 8.3).
    if canonical in {"urgent_order_added", "order_added"} and payload.request is not None:
        existing_ids = {
            item["id"] for item in (base_plan.input_payload or {}).get("requests", [])
        }
        if payload.request.id in existing_ids:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "error": {
                        "code": "DUPLICATE_REQUEST",
                        "message": f"Заявка с ID {payload.request.id} уже существует",
                        "details": {"request_id": payload.request.id},
                    }
                },
            )
    apply_value = payload.apply if payload.apply is not None else default_apply(canonical)
    status_value = "applied" if apply_value else "proposed"
    # Реальный геокодер для новой заявки (авария оператора/диспетчера), п. 15, 46.
    if payload.request is not None and payload.request.latitude is None:
        from app.core.regions import get_region
        from app.services import day_plan as day_plan_service

        # офис — у корня дня: у производного сценария версии его нет, у события диспетчера нет
        # params.region_id, и срочная без адреса получала (0, 0) (п. 46)
        root = day_plan_service.for_plan(repository, base_plan)
        meta = (root.scenario_metadata or {}) if root is not None else {}
        office = meta.get("office")
        if office is None:
            region_key = meta.get("region_id") or (payload.params or {}).get("region_id")
            office = (get_region(region_key, repository) or {}).get("office")
        _geocode_request(repository, payload.request, office)
    # Реальное время/часы дня (D-24): если время события не задано — берём «сейчас» дня.
    if payload.event_time_value() is None:
        from app.services.day_clock import resolve_now

        payload.event_time = resolve_now(repository, base_plan.scenario_id)

    solver = payload.solver or "hybrid_v2"
    seed = payload.seed if payload.seed is not None else 42

    try:
        if canonical == "manual_reassign":
            computation = engine.apply_manual_reassign(
                base_plan,
                payload.order_id or "",
                str(payload.params.get("to_engineer_id")),
                payload.params.get("position"),
                bool(payload.params.get("force", False)),
            )
        elif canonical == "extend_resource":
            computation = engine.extend_resource(
                base_plan,
                list(payload.params.get("order_ids", [])),
                str(payload.params.get("option", "extend_shift")),
                payload.params,
                solver=solver,
                seed=seed,
                total_seconds=payload.time_limit_seconds or 5.0,
            )
        else:
            computation = engine.apply(base_plan, payload)
    except AlgorithmError as exc:
        message = str(exc)
        code = (
            status.HTTP_404_NOT_FOUND
            if "не найден" in message.lower()
            else status.HTTP_422_UNPROCESSABLE_ENTITY
        )
        raise HTTPException(status_code=code, detail=message) from exc

    event, plan, _ = persist_replan(
        repository,
        base_plan,
        computation,
        event_type=canonical,
        event_payload={**computation.applied_event, "scenario": computation.scenario},
        status=status_value,
        solver=solver,
        seed=seed,
    )
    return ReplanResult(
        event_id=event.id,
        event_type=canonical,
        previous_plan_id=base_plan.id,
        status=status_value,
        plan=plan_to_response(plan, ors_client=ors_client),
        changes=computation.changes,
        change_summary=summarize_changes(computation.changes),
        applied_event=computation.applied_event,
        scenario=computation.scenario,
        violations=computation.violations,
    )


@router.post(
    "/apply",
    response_model=ReplanResult,
    summary="Применить событие (S1–S14)",
    response_description="Новая версия плана, список изменений и детали сценария.",
    responses=error_responses("not_found", "validation"),
    description=_APPLY_DESCRIPTION,
)
def apply_event(
    payload: ApplyEventRequest,
    repository: Repository = Depends(get_repository),
    engine=Depends(get_replan_engine),
    ors_client: OpenRouteServiceClient | None = Depends(get_ors_client),
    user=Depends(get_current_user),
) -> ReplanResult:
    """Применяет событие рабочего дня."""
    return _apply_event_impl(payload, repository, engine, ors_client, user)


@router.post(
    "/replan",
    response_model=ReplanResult,
    deprecated=True,
    summary="[Устарело] Применить событие",
    responses=error_responses("not_found", "validation"),
    description="Устаревший алиас `POST /events/apply` (старые имена типов поддерживаются).",
)
def replan(
    payload: ApplyEventRequest,
    repository: Repository = Depends(get_repository),
    engine=Depends(get_replan_engine),
    ors_client: OpenRouteServiceClient | None = Depends(get_ors_client),
    user=Depends(get_current_user),
) -> ReplanResult:
    """Совместимость: старый контракт перепланирования."""
    return _apply_event_impl(payload, repository, engine, ors_client, user)


@router.get(
    "",
    response_model=list[EventItem],
    summary="История событий перепланирования",
)
def list_events(
    plan_id: str | None = None,
    scenario_id: str | None = None,
    limit: int = 50,
    repository: Repository = Depends(get_repository),
) -> list[EventItem]:
    """Возвращает журнал событий перепланирования."""
    events = repository.list_events(plan_id=plan_id, limit=limit)
    items: list[EventItem] = []
    for event in events:
        payload = event.payload or {}
        if scenario_id and event.scenario_id != scenario_id:
            continue
        applied_event = payload.get("applied_event") or {}
        needs_decision = bool(payload.get("needs_decision"))
        if event.result_plan_id:
            plan = repository.get_plan(event.result_plan_id)
            if plan is not None:
                needs_decision = needs_decision or plan.status == "proposed"
                needs_decision = needs_decision or bool((plan.result or {}).get("unassigned"))
        items.append(
            EventItem(
                event_id=event.id,
                event_type=event.event_type,
                plan_id=event.plan_id,
                scenario_id=event.scenario_id,
                result_plan_id=event.result_plan_id,
                headline=payload.get("headline"),
                source=payload.get("source") or applied_event.get("source"),
                event_time=payload.get("event_time") or payload.get("time") or applied_event.get("time"),
                order_id=payload.get("order_id")
                or payload.get("request_id")
                or applied_event.get("request_id"),
                engineer_id=payload.get("engineer_id") or applied_event.get("engineer_id"),
                status=payload.get("status"),
                flag=payload.get("flag"),
                applied_at=payload.get("applied_at"),
                payload=payload,
                needs_decision=needs_decision,
                created_at=event.created_at,
            )
        )
    return items


@router.delete(
    "",
    response_model=MessageResponse,
    summary="Удалить все события",
    response_description="Сообщение с числом удалённых событий.",
)
def delete_all_events(
    repository: Repository = Depends(get_repository),
) -> MessageResponse:
    """Полностью очищает журнал событий."""
    count = repository.delete_all_events()
    return MessageResponse(message=f"Удалено событий: {count}")


@router.delete(
    "/{event_id}",
    response_model=MessageResponse,
    summary="Удалить событие",
    response_description="Сообщение об удалении события.",
    responses=error_responses("not_found"),
)
def delete_event(
    event_id: str,
    repository: Repository = Depends(get_repository),
) -> MessageResponse:
    """Удаляет событие по ID."""
    if not repository.delete_event(event_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Событие не найдено")
    return MessageResponse(message=f"Событие {event_id} удалено")

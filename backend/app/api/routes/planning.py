"""Маршруты запуска планирования, получения плана и сравнения с базой."""
from __future__ import annotations

from typing import Literal

from fastapi import Security, APIRouter, Depends, HTTPException, Query, status

from app.api.deps import (
    get_ors_client,
    get_planner_service,
    get_replan_engine,
    get_repository,
    get_strategy_service,
    verify_token,
)
from app.api.responses import error_responses
from app.schemas.common import MessageResponse
from app.schemas.event import (
    CompareRequest,
    CompareResponse,
    ExtendResourceCheckResponse,
    ExtendResourceRequest,
    ExtendResourceResponse,
    PlanVersionResponse,
    ReassignCheckResponse,
    ReassignRequest,
    ReplanResult,
    SuggestRequest,
    SuggestResponse,
    WhatIfRequest,
    WhatIfResponse,
)
from app.schemas.plan import (
    BaselineRequest,
    BaselineResponse,
    ExplanationOut,
    PlanListResponse,
    PlanResponse,
    PlanningRunRequest,
)
from app.schemas.extras import PlanDiffResponse
from app.services.algorithm_adapter import AlgorithmError
from app.services.baseline_service import BaselineService
from app.services.diff_service import build_diff
from app.services.metrics_service import (
    compare_metrics,
    metric_block_from_report,
    summarize_changes,
)
from app.services.ors_client import OpenRouteServiceClient
from app.services.plan_persistence import persist_replan
from app.services.plan_presenter import plan_to_list_item, plan_to_response
from app.services.planner_service import PlannerService
from app.services.route_service import attach_route_geometry, build_routes
from app.storage.repository import Repository

router = APIRouter(prefix="/planning", tags=["Планирование"], dependencies=[Security(verify_token)])


def _resolve_scenario(repository: Repository, scenario_id: str | None):
    """Возвращает сценарий по ID или последний загруженный."""
    if scenario_id:
        scenario = repository.get_scenario(scenario_id)
        if scenario is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Сценарий не найден")
        return scenario
    scenarios = repository.list_scenarios(limit=1)
    if not scenarios:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Нет загруженных сценариев. Сначала вызовите /api/v1/data/load",
        )
    return scenarios[0]


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
            detail="Нет сохранённых планов. Сначала вызовите /api/v1/planning/run",
        )
    return plans[0]


@router.post(
    "/run",
    response_model=PlanResponse,
    summary="Запустить планирование",
    response_description=(
        "Сохранённый план: сводка, метрики (сравнение с базой при "
        "`include_baseline=true`), маршруты с дорожной геометрией, назначения, "
        "неназначенные заявки с причинами и объяснения."
    ),
    responses=error_responses("validation", "internal"),
    description=(
        "Берёт сохранённый сценарий, запускает существующий алгоритм через адаптер, "
        "сохраняет результат и возвращает распределение заявок, маршруты, объяснения "
        "и метрики. Если включено сравнение, дополнительно считается базовый сценарий."
    ),
)
def run_planning(
    payload: PlanningRunRequest,
    repository: Repository = Depends(get_repository),
    planner: PlannerService = Depends(get_planner_service),
    ors_client: OpenRouteServiceClient | None = Depends(get_ors_client),
) -> PlanResponse:
    """Запускает оптимизацию для выбранного сценария."""
    scenario = _resolve_scenario(repository, payload.scenario_id)
    try:
        computation = planner.compute(
            scenario.engineers,
            scenario.requests,
            solver=payload.solver,
            seed=payload.seed,
            time_limit=payload.time_limit_seconds,
            include_baseline=payload.include_baseline,
        )
    except AlgorithmError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    plan = repository.create_plan(
        scenario_id=scenario.id,
        input_payload={
            "engineers": computation.problem.engineers,
            "requests": computation.problem.requests,
            "name": scenario.name,
        },
        result=computation.api_result,
        metrics=computation.metrics,
        algorithm_meta=computation.algorithm_meta,
        kind="optimized",
        status="draft",
    )
    # Живое обновление: план посчитан (черновик) (§38).
    try:
        from app.realtime.hub import hub

        meta = scenario.scenario_metadata or {}
        hub.publish(
            "plan.built",
            region_id=meta.get("region_id"),
            date=meta.get("date"),
            data={"plan_id": plan.id},
        )
    except Exception:  # noqa: BLE001
        pass
    return plan_to_response(plan, ors_client=ors_client)


@router.get(
    "",
    response_model=PlanListResponse,
    summary="Список сохранённых планов",
)
def list_plans(
    scenario_id: str | None = None,
    limit: int = 50,
    repository: Repository = Depends(get_repository),
) -> PlanListResponse:
    """Возвращает последние сохранённые планы."""
    plans = repository.list_plans(scenario_id=scenario_id, limit=limit)
    items = [plan_to_list_item(plan) for plan in plans]
    return PlanListResponse(count=len(items), items=items)


@router.get(
    "/{plan_id}",
    response_model=PlanResponse,
    summary="Получить план по ID",
    response_description="Полный сохранённый план.",
    responses=error_responses("not_found"),
    description=(
        "Возвращает полный сохранённый результат: маршруты, назначения, "
        "объяснения, неназначенные заявки и метрики. По умолчанию геометрия "
        "маршрутов — прямые отрезки (быстро); `?geometry=road` строит дорожную "
        "геометрию через OpenRouteService."
    ),
)
def get_plan(
    plan_id: str,
    geometry: Literal["road", "straight"] = Query(
        "road",
        description="`road` — дорожная геометрия маршрутов; `straight` — быстрые прямые отрезки.",
    ),
    repository: Repository = Depends(get_repository),
    ors_client: OpenRouteServiceClient | None = Depends(get_ors_client),
) -> PlanResponse:
    """Возвращает полный план."""
    plan = repository.get_plan(plan_id)
    if plan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="План не найден")
    client = ors_client if geometry == "road" else None
    return plan_to_response(plan, ors_client=client)


@router.get(
    "/{plan_id}/explanations",
    response_model=list[ExplanationOut],
    summary="Объяснения решений по плану",
    response_description="Список объяснений по каждой назначенной и неназначенной заявке.",
    responses=error_responses("not_found"),
    description="Возвращает понятные диспетчеру объяснения по каждой назначенной и неназначенной заявке.",
)
def get_explanations(
    plan_id: str,
    repository: Repository = Depends(get_repository),
) -> list[ExplanationOut]:
    """Возвращает объяснения по всем заявкам плана."""
    plan = repository.get_plan(plan_id)
    if plan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="План не найден")
    return [ExplanationOut(**item) for item in (plan.result or {}).get("explanations", [])]


@router.post(
    "/baseline",
    response_model=BaselineResponse,
    summary="Сравнить с базовым сценарием",
    response_description="Метрики оптимизированного и базового планов, экономия и маршруты базы.",
    responses=error_responses("not_found", "validation"),
    description=(
        "Строит простой базовый план (заявки по порядку, первый подходящий инженер, "
        "добавление в конец маршрута) и сравнивает его с оптимизированным по обязательным метрикам."
    ),
)
def compare_baseline(
    payload: BaselineRequest,
    repository: Repository = Depends(get_repository),
    planner: PlannerService = Depends(get_planner_service),
    ors_client: OpenRouteServiceClient | None = Depends(get_ors_client),
) -> BaselineResponse:
    """Считает базовый план и сравнивает метрики с оптимизированным."""
    plan = _resolve_plan(repository, payload.plan_id)
    input_payload = plan.input_payload or {}
    engineers = input_payload.get("engineers", [])
    requests = input_payload.get("requests", [])
    if not engineers or not requests:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="В плане нет входных данных для построения базового сценария",
        )
    try:
        problem = planner.adapter.prepare_problem(engineers, requests)
        baseline_service = BaselineService(planner.adapter)
        _, baseline_report = baseline_service.compute(problem)
    except AlgorithmError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    optimized_report = (plan.algorithm_meta or {}).get("algorithm_report", {})
    optimized_block = metric_block_from_report(optimized_report)
    baseline_block = metric_block_from_report(baseline_report)
    comparison = compare_metrics(optimized_block, baseline_block)
    return BaselineResponse(
        plan_id=plan.id,
        optimized=optimized_block,
        baseline=baseline_block,
        comparison=comparison,
        baseline_routes=attach_route_geometry(build_routes(problem, baseline_report), ors_client),
    )


@router.delete(
    "",
    response_model=MessageResponse,
    summary="Удалить все планы",
    response_description="Сообщение с числом удалённых планов.",
    description="Удаляет все сохранённые планы вместе со связанными событиями.",
)
def delete_all_plans(
    repository: Repository = Depends(get_repository),
) -> MessageResponse:
    """Полностью очищает планы и события."""
    count = repository.delete_all_plans()
    return MessageResponse(message=f"Удалено планов: {count} (вместе со связанными событиями)")


@router.delete(
    "/{plan_id}",
    response_model=MessageResponse,
    summary="Удалить план",
    response_description="Сообщение об удалении плана.",
    responses=error_responses("not_found"),
    description="Удаляет план вместе с производными планами и связанными событиями.",
)
def delete_plan(
    plan_id: str,
    repository: Repository = Depends(get_repository),
) -> MessageResponse:
    """Удаляет план по ID."""
    if not repository.delete_plan(plan_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="План не найден")
    return MessageResponse(message=f"План {plan_id} удалён")


# --- Версии плана (proposed / applied / rejected) --------------------------
@router.post(
    "/{plan_id}/apply",
    response_model=PlanVersionResponse,
    summary="Применить предложенную версию плана",
    responses=error_responses("not_found"),
)
def apply_plan_version(
    plan_id: str,
    repository: Repository = Depends(get_repository),
    planner=Depends(get_planner_service),
    engine=Depends(get_replan_engine),
) -> PlanVersionResponse:
    """Переводит версию плана в статус `applied`, прежнюю applied — в `superseded`."""
    plan = repository.get_plan(plan_id)
    if plan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="План не найден")
    # STALE_PROPOSAL: предложение опиралось на версию, которая уже не действует.
    if plan.status == "proposed" and plan.parent_plan_id:
        parent = repository.get_plan(plan.parent_plan_id)
        if parent is not None and parent.status in {"superseded", "rejected"}:
            from app.services import day_plan as day_plan_service

            root = day_plan_service.for_plan(repository, parent)
            active = day_plan_service.active_plan(repository, root)
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "error": {
                        "code": "STALE_PROPOSAL",
                        "message": "Предложение устарело: действующая версия изменилась, пересчитайте",
                        "details": {"active_plan_id": active.id if active else None},
                    }
                },
            )
    version = 1
    root = None
    if plan.scenario_id:
        from app.services import day_plan as day_plan_service

        root = day_plan_service.for_plan(repository, plan)
        # Номер версии присваивается только при применении: действующий + 1.
        version = day_plan_service.current_version_seq(repository, root) + 1
    # Версии живут в производных сценариях: гасим применённую родительскую версию.
    if plan.parent_plan_id:
        parent = repository.get_plan(plan.parent_plan_id)
        if parent is not None and parent.status == "applied":
            parent.status = "superseded"
            repository.session.commit()
    meta = dict(plan.algorithm_meta or {})
    meta["version"] = version
    plan.algorithm_meta = meta
    plan.status = "applied"
    repository.session.commit()
    if root is not None:
        from app.services.plan_persistence import activate_plan

        activate_plan(repository, plan, version, root)
    elif plan.scenario_id:
        scenario = repository.get_scenario(plan.scenario_id)
        if scenario is not None:
            metadata = dict(scenario.scenario_metadata or {})
            metadata["active_plan_id"] = plan.id
            metadata["version"] = version
            scenario.scenario_metadata = metadata
            repository.update_scenario(scenario)
    from app.services.day_clock import resolve_now

    _apply_operator_decision(repository, plan, planner, engine)

    repository.create_event(
        event_type="plan_applied",
        payload={
            "headline": f"Версия {version} применена. Инженеры получили обновление",
            "source": "dispatcher",
            "applied_at": resolve_now(repository, plan.scenario_id),
        },
        plan_id=plan.parent_plan_id or plan.id,
        scenario_id=plan.scenario_id,
        result_plan_id=plan.id,
    )
    try:
        from app.realtime.hub import hub

        meta = dict((root.scenario_metadata or {})) if root is not None else {}
        applied_changes = [
            {"request_id": c.get("task_id"), "kind": c.get("kind")}
            for c in ((plan.result or {}).get("changes") or [])
        ]
        hub.publish(
            # Первая публикация черновика — «день начат», пересчёт — «применено» (§38).
            "plan.published" if plan.kind == "optimized" else "plan.applied",
            region_id=meta.get("region_id"),
            date=meta.get("date"),
            data={
                "plan_id": plan.id,
                "version": version,
                "event_type": (plan.algorithm_meta or {}).get("event_type"),
                "engineers": sorted({c["before"][0] for c in applied_changes if c.get("before")} |
                                    {c["after"][0] for c in applied_changes if c.get("after")}),
                "changes": applied_changes,
            },
        )
    except Exception:  # noqa: BLE001
        pass
    return PlanVersionResponse(plan_id=plan.id, status=plan.status, active_plan_id=plan.id)


@router.post(
    "/{plan_id}/reject",
    response_model=PlanVersionResponse,
    summary="Отклонить предложенную версию плана",
    responses=error_responses("not_found"),
)
def reject_plan_version(
    plan_id: str,
    repository: Repository = Depends(get_repository),
) -> PlanVersionResponse:
    """Переводит версию плана в статус `rejected` и возвращает действующий план."""
    plan = repository.get_plan(plan_id)
    if plan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="План не найден")
    if plan.status != "proposed":
        # Отклонять можно только предложение (п. 48).
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"error": {"code": "ILLEGAL_TRANSITION", "message": "Отклонить можно только предложенную версию"}},
        )
    plan = repository.set_plan_status(plan_id, "rejected")
    _restore_rejected_engineer_action(repository, plan)
    try:
        from app.realtime.hub import hub

        from app.services import day_plan as day_plan_service

        root = day_plan_service.for_plan(repository, plan)
        meta = (root.scenario_metadata or {}) if root is not None else {}
        hub.publish(
            "plan.rejected",
            region_id=meta.get("region_id"),
            date=meta.get("date"),
            data={"plan_id": plan.id, "event_type": (plan.algorithm_meta or {}).get("event_type")},
        )
    except Exception:  # noqa: BLE001
        pass
    active = repository.active_plan_for_scenario(plan.scenario_id) if plan.scenario_id else None
    return PlanVersionResponse(
        plan_id=plan.id,
        status=plan.status,
        active_plan_id=active.id if active and active.id != plan.id else None,
    )


@router.post(
    "/{plan_id}/rebase",
    response_model=ReplanResult,
    summary="Пересчитать устаревшее предложение на действующей версии (п. 48)",
    responses=error_responses("not_found", "validation"),
)
def rebase_plan_version(
    plan_id: str,
    repository: Repository = Depends(get_repository),
    engine=Depends(get_replan_engine),
    ors_client: OpenRouteServiceClient | None = Depends(get_ors_client),
) -> ReplanResult:
    """Повторяет событие устаревшего предложения на действующей версии дня."""
    from app.api.routes.events import _apply_event_impl
    from app.schemas.event import ApplyEventRequest
    from app.schemas.request import RequestIn
    from app.services import day_plan as day_plan_service
    from app.services.day_clock import resolve_now

    plan = repository.get_plan(plan_id)
    if plan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="План не найден")
    if plan.status != "proposed":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"error": {"code": "ILLEGAL_TRANSITION", "message": "Пересчитать можно только предложение"}},
        )
    scenario = repository.get_scenario(plan.scenario_id) if plan.scenario_id else None
    meta = (scenario.scenario_metadata if scenario is not None else {}) or {}
    applied = meta.get("applied_event") or {}
    event_type = meta.get("event_type") or applied.get("type")
    root = day_plan_service.for_plan(repository, plan)
    active = day_plan_service.active_plan(repository, root)
    if active is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"error": {"code": "DAY_NOT_STARTED", "message": "Действующей версии дня нет"}},
        )
    kwargs: dict = {
        "type": event_type,
        "plan_id": active.id,
        "event_time": applied.get("time") or resolve_now(repository, active.scenario_id),
        "source": applied.get("source") or "dispatcher",
        "apply": False,
    }
    request_id = applied.get("request_id") or applied.get("order_id")
    engineer_id = applied.get("engineer_id")
    if event_type in {"urgent_order_added", "order_added"}:
        parent_ids = {item["id"] for item in (active.input_payload or {}).get("requests", [])}
        new_request = next(
            (
                item
                for item in (plan.input_payload or {}).get("requests", [])
                if item["id"] not in parent_ids
            ),
            None,
        )
        if new_request is None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Заявка события не найдена")
        clean = {k: v for k, v in new_request.items() if not k.startswith("_") and k not in {"status"}}
        kwargs["request"] = RequestIn(**clean)
    elif event_type in {"order_cancelled", "order_window_changed", "order_scope_changed"}:
        kwargs["order_id"] = request_id
        params: dict = {}
        if event_type == "order_window_changed":
            parent_req = next(
                (r for r in (active.input_payload or {}).get("requests", []) if r["id"] == request_id), {}
            )
            new_req = next(
                (r for r in (plan.input_payload or {}).get("requests", []) if r["id"] == request_id), {}
            )
            params = {
                "window_start": new_req.get("window_start", parent_req.get("window_start")),
                "window_end": new_req.get("window_end", parent_req.get("window_end")),
            }
        kwargs["params"] = {**applied, **params}
    elif event_type in {"engineer_unavailable", "engineer_delayed", "finished_early", "transport_changed", "engineer_available"}:
        kwargs["engineer_id"] = engineer_id
        kwargs["params"] = dict(applied)
    else:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Пересчёт события {event_type} не поддержан",
        )
    payload = ApplyEventRequest(**kwargs)
    result = _apply_event_impl(payload, repository, engine, ors_client, user=None)
    repository.set_plan_status(plan_id, "superseded")
    return result


def _apply_operator_decision(repository: Repository, plan, planner=None, engine=None) -> None:
    """После «Принять» доводит запись оператора (п. 35, 39): отмена, перенос, смена окна."""
    event_id = (plan.algorithm_meta or {}).get("event_id")
    if not event_id:
        return
    event = repository.get_event(event_id)
    if event is None:
        return
    payload = event.payload or {}
    if event.event_type == "order_window_changed" and payload.get("source") == "operator":
        _finish_window_change(repository, plan, payload, accepted=True)
        return
    if payload.get("stage") != "operator":
        return
    request_id = payload.get("request_id") or payload.get("order_id")
    if not request_id:
        return
    from app.services import day_plan as day_plan_service

    root = day_plan_service.for_plan(repository, plan)
    if root is None:
        return
    rescheduled = payload.get("rescheduled_to")
    for request in root.requests:
        if request.get("id") != request_id:
            continue
        # в сохранённом событии rescheduled_to нет — перенос помнит сама запись
        if not rescheduled and request.get("status") == "reschedule_pending":
            rescheduled = request.get("_rescheduled_to")
        if rescheduled:
            request["status"] = "rescheduled"
            request["_rescheduled_to"] = rescheduled
        else:
            request["status"] = "cancelled"
            request["_cancel_reason"] = payload.get("reason")
        request.pop("_operator_previous_status", None)
        repository.update_scenario(root)
        meta = root.scenario_metadata or {}
        try:
            from app.realtime.hub import hub

            hub.publish(
                "booking.decision",
                region_id=meta.get("region_id"),
                date=meta.get("date"),
                data={
                    "request_id": request_id,
                    "action": "reschedule" if rescheduled else "cancel",
                    "decision": "accepted",
                },
            )
        except Exception:  # noqa: BLE001
            pass
        if rescheduled and planner is not None and engine is not None:
            # заявка встаёт в целевой день только после «Принять» (п. 39, S5)
            from app.api.routes.booking import move_to_day

            move_to_day(
                repository, planner, engine, request, meta.get("region_id", "east"), meta.get("date"), rescheduled
            )
        break


def _finish_window_change(repository: Repository, plan, payload: dict, accepted: bool) -> None:
    """Смена окна записи оператора в начатом дне: «Принять» — новое окно, «Отклонить» — прежнее (п. 39)."""
    request_id = payload.get("request_id") or payload.get("order_id")
    if not request_id:
        return
    from app.services import day_plan as day_plan_service

    root = day_plan_service.for_plan(repository, plan)
    if root is None:
        return
    for request in root.requests:
        if request.get("id") != request_id:
            continue
        target = request.get("_rescheduled_to") or {}
        if accepted and isinstance(target.get("window"), str) and "-" in target["window"]:
            request["window_start"], request["window_end"] = target["window"].split("-", 1)
        request["status"] = request.get("_operator_previous_status") or "planned"
        request.pop("_operator_previous_status", None)
        request.pop("_rescheduled_to", None)
        repository.update_scenario(root)
        try:
            from app.realtime.hub import hub

            meta = root.scenario_metadata or {}
            hub.publish(
                "booking.decision",
                region_id=meta.get("region_id"),
                date=meta.get("date"),
                data={
                    "request_id": request_id,
                    "action": "reschedule",
                    "decision": "accepted" if accepted else "rejected",
                },
            )
        except Exception:  # noqa: BLE001
            pass
        break


def _restore_rejected_engineer_action(repository: Repository, plan) -> None:
    """Возвращает точку прежней версии, если инженер «Прервал» и диспетчер отклонил.

    П. 13: причина с ``stage=on_site`` хранит ``previous_status`` — восстанавливаем
    и пишем баннер в ленту.
    """
    if not plan.parent_plan_id:
        return
    event_id = (plan.algorithm_meta or {}).get("event_id")
    if not event_id:
        return
    event = repository.get_event(event_id)
    if event is None:
        return
    if event.event_type == "order_window_changed" and (event.payload or {}).get("source") == "operator":
        _finish_window_change(repository, plan, event.payload or {}, accepted=False)
        return
    if event.event_type != "order_cancelled":
        return
    payload = event.payload or {}
    if payload.get("stage") == "operator":
        # Возврат записи оператора после «Отклонить» (п. 35, 39).
        request_id = payload.get("request_id") or payload.get("order_id")
        if not request_id:
            return
        from app.services import day_plan as day_plan_service

        root = day_plan_service.for_plan(repository, plan)
        if root is None:
            return
        for request in root.requests:
            if request.get("id") != request_id:
                continue
            request["status"] = payload.get("previous_status") or "planned"
            request.pop("_operator_previous_status", None)
            request.pop("_rescheduled_to", None)
            repository.update_scenario(root)
            repository.create_event(
                event_type="engineer_action",
                payload={
                    "headline": f"Диспетчер вернул №{request_id} в план",
                    "source": "dispatcher",
                    "request_id": request_id,
                    "status": request["status"],
                },
                plan_id=plan.parent_plan_id,
                scenario_id=root.id,
                result_plan_id=None,
            )
            try:
                from app.realtime.hub import hub

                meta = root.scenario_metadata or {}
                hub.publish(
                    "booking.decision",
                    region_id=meta.get("region_id"),
                    date=meta.get("date"),
                    data={"request_id": request_id, "action": "cancel", "decision": "rejected"},
                )
            except Exception:  # noqa: BLE001
                pass
            break
        return
    if payload.get("stage") != "on_site" or not payload.get("previous_status"):
        return
    parent = repository.get_plan(plan.parent_plan_id)
    if parent is None:
        return
    request_id = payload.get("request_id") or payload.get("order_id")
    if not request_id:
        return
    restored = False
    result = dict(parent.result or {})
    for route in result.get("routes", []):
        for point in route.get("route", []):
            if point.get("request_id") == request_id:
                point["status"] = payload["previous_status"]
                restored = True
    if not restored:
        return
    parent.result = result
    repository.save_plan(parent)
    repository.create_event(
        event_type="engineer_action",
        payload={
            "headline": f"Диспетчер вернул №{request_id} в план",
            "source": "dispatcher",
            "request_id": request_id,
            "status": payload["previous_status"],
        },
        plan_id=parent.id,
        scenario_id=parent.scenario_id,
        result_plan_id=None,
    )


@router.get(
    "/{plan_id}/diff",
    response_model=PlanDiffResponse,
    summary="Diff двух версий плана",
    responses=error_responses("not_found"),
    description="Показывает, что изменилось относительно `against` (по умолчанию — родительская версия).",
)
def get_plan_diff(
    plan_id: str,
    against: str | None = None,
    repository: Repository = Depends(get_repository),
) -> PlanDiffResponse:
    """Строит понятный диспетчеру diff версий."""
    new_plan = repository.get_plan(plan_id)
    if new_plan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="План не найден")
    base_id = against or new_plan.parent_plan_id
    if not base_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Нет базовой версии: передайте ?against=<plan_id>",
        )
    base_plan = repository.get_plan(base_id)
    if base_plan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Базовая версия не найдена")
    return build_diff(
        base_plan.result or {}, new_plan.result or {}, base_plan.id, new_plan.id
    )


@router.get(
    "/{plan_id}/requests/{request_id}",
    summary="Карточка заявки в плане",
    responses=error_responses("not_found"),
    description="Одним запросом: заявка, визит, объяснение и флаги.",
)
def get_plan_request(
    plan_id: str,
    request_id: str,
    repository: Repository = Depends(get_repository),
) -> dict:
    """Возвращает карточку заявки."""
    plan = repository.get_plan(plan_id)
    if plan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="План не найден")
    result = plan.result or {}
    request_data = next(
        (
            item
            for item in (plan.input_payload or {}).get("requests", [])
            if item["id"] == request_id
        ),
        None,
    )
    if request_data is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Заявка не найдена")
    visit = None
    for route in result.get("routes", []):
        for point in route.get("route", []):
            if point["request_id"] == request_id:
                visit = {"engineer_id": route["engineer_id"], **point}
                break
    explanation = next(
        (item for item in result.get("explanations", []) if item["request_id"] == request_id),
        None,
    )
    unassigned = next(
        (item for item in result.get("unassigned", []) if item["request_id"] == request_id),
        None,
    )
    return {
        "request": request_data,
        "visit": visit,
        "explanation": explanation,
        "unassigned": unassigned,
        "flags": (visit or {}).get("flags", []),
    }


# --- Ручное переназначение (S2) --------------------------------------------
@router.post(
    "/{plan_id}/reassign/check",
    response_model=ReassignCheckResponse,
    summary="Проверить ручное переназначение",
    responses=error_responses("not_found", "validation"),
    description="Проверяет 3(4) ограничения и последствия переноса заявки, версию не создаёт.",
)
def check_reassign(
    plan_id: str,
    payload: ReassignRequest,
    repository: Repository = Depends(get_repository),
    engine=Depends(get_replan_engine),
) -> ReassignCheckResponse:
    """Проверяет переназначение заявки другому инженеру."""
    plan = repository.get_plan(plan_id)
    if plan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="План не найден")
    try:
        result = engine.check_reassign(
            plan,
            payload.order_id,
            payload.to_engineer_id,
            payload.position,
            payload.time or _day_time(repository, plan),
        )
    except AlgorithmError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    return ReassignCheckResponse(**result)


def _day_time(repository: Repository, plan) -> str | None:
    """Текущее время дня, если день начат (для проверки «не раньше сейчас», п. 47)."""
    if plan.status not in {"applied", "completed"}:
        return None
    from app.services.day_clock import resolve_now

    return resolve_now(repository, plan.scenario_id)


@router.post(
    "/{plan_id}/reassign",
    response_model=ReplanResult,
    summary="Применить ручное переназначение",
    responses=error_responses("not_found", "validation"),
)
def manual_reassign(
    plan_id: str,
    payload: ReassignRequest,
    repository: Repository = Depends(get_repository),
    engine=Depends(get_replan_engine),
    ors_client: OpenRouteServiceClient | None = Depends(get_ors_client),
) -> ReplanResult:
    """Применяет ручное переназначение и сохраняет новую версию плана."""
    base_plan = repository.get_plan(plan_id)
    if base_plan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="План не найден")
    try:
        computation = engine.apply_manual_reassign(
            base_plan,
            payload.order_id,
            payload.to_engineer_id,
            payload.position,
            payload.force,
            payload.time or _day_time(repository, base_plan),
        )
    except AlgorithmError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    event, plan, _ = persist_replan(
        repository,
        base_plan,
        computation,
        event_type="manual_reassign",
        event_payload=computation.applied_event,
        status="proposed",
    )
    return ReplanResult(
        event_id=event.id,
        event_type="manual_reassign",
        previous_plan_id=base_plan.id,
        status="proposed",
        plan=plan_to_response(plan, ors_client=ors_client),
        changes=computation.changes,
        change_summary=summarize_changes(computation.changes),
        applied_event=computation.applied_event,
        scenario=computation.scenario,
        violations=computation.violations,
    )


# --- Подсказки, песочница, добор ресурса, сравнение ------------------------
@router.post(
    "/{plan_id}/suggest",
    response_model=SuggestResponse,
    summary="Подсказки для освободившегося инженера (S8)",
    responses=error_responses("not_found", "validation"),
)
def suggest_for_idle(
    plan_id: str,
    payload: SuggestRequest,
    repository: Repository = Depends(get_repository),
    engine=Depends(get_replan_engine),
) -> SuggestResponse:
    """Подбирает заявки в свободный промежуток инженера."""
    plan = repository.get_plan(plan_id)
    if plan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="План не найден")
    try:
        result = engine.suggest(
            plan, payload.engineer_id, payload.from_time, payload.to_time
        )
    except AlgorithmError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    return SuggestResponse(**result)


@router.post(
    "/{plan_id}/what-if",
    response_model=WhatIfResponse,
    summary="Песочница «что если» (S14)",
    responses=error_responses("not_found", "validation"),
    description="Считает последствия изменений, ничего не сохраняет.",
)
def what_if(
    plan_id: str,
    payload: WhatIfRequest,
    repository: Repository = Depends(get_repository),
    engine=Depends(get_replan_engine),
) -> WhatIfResponse:
    """Просчитывает гипотетические изменения без сохранения."""
    plan = repository.get_plan(plan_id)
    if plan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="План не найден")
    try:
        result = engine.what_if(
            plan,
            payload.changes,
            solver=payload.solver or "hybrid_v2",
            seed=payload.seed if payload.seed is not None else 42,
            total_seconds=payload.time_limit_seconds or 5.0,
        )
    except AlgorithmError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    return WhatIfResponse(**{k: v for k, v in result.items() if k in {"delta_metrics", "summary", "preview"}})


@router.post(
    "/{plan_id}/extend-resource",
    response_model=ExtendResourceResponse,
    summary="Добор ресурса под неназначенные (S13)",
    responses=error_responses("not_found", "validation"),
)
def extend_resource(
    plan_id: str,
    payload: ExtendResourceRequest,
    repository: Repository = Depends(get_repository),
    engine=Depends(get_replan_engine),
    ors_client: OpenRouteServiceClient | None = Depends(get_ors_client),
) -> ExtendResourceResponse:
    """Продлевает смену или добавляет инженера под неназначенные заявки."""
    base_plan = repository.get_plan(plan_id)
    if base_plan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="План не найден")
    try:
        computation = engine.extend_resource(
            base_plan,
            payload.order_ids,
            payload.option,
            payload.params,
            total_seconds=payload.time_limit_seconds or 5.0,
        )
    except AlgorithmError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    status_value = "applied" if payload.apply else "proposed"
    _, plan, _ = persist_replan(
        repository,
        base_plan,
        computation,
        event_type="extend_resource",
        event_payload=computation.applied_event,
        status=status_value,
    )
    scenario = computation.scenario.get("extend_resource", {})
    return ExtendResourceResponse(
        plan=plan_to_response(plan, ors_client=ors_client),
        closed=scenario.get("closed", []),
        still_unassigned=scenario.get("still_unassigned", []),
        cost=scenario.get("cost", {}),
    )


@router.post(
    "/{plan_id}/extend-resource/check",
    response_model=ExtendResourceCheckResponse,
    summary="Рассчитать добор ресурса без сохранения (DS-09)",
    responses=error_responses("not_found", "validation"),
    description="Считает, какие заявки закроются и что для этого нужно, версию плана не создаёт.",
)
def check_extend_resource(
    plan_id: str,
    payload: ExtendResourceRequest,
    repository: Repository = Depends(get_repository),
    engine=Depends(get_replan_engine),
) -> ExtendResourceCheckResponse:
    """Расчёт добора ресурса без сохранения версии и события."""
    base_plan = repository.get_plan(plan_id)
    if base_plan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="План не найден")
    try:
        computation = engine.extend_resource(
            base_plan,
            payload.order_ids,
            payload.option,
            payload.params,
            total_seconds=payload.time_limit_seconds or 5.0,
        )
    except AlgorithmError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
    scenario = computation.scenario.get("extend_resource", {})
    return ExtendResourceCheckResponse(
        closed=scenario.get("closed", []),
        still_unassigned=scenario.get("still_unassigned", []),
        cost=scenario.get("cost", {}),
    )


@router.post(
    "/compare",
    response_model=CompareResponse,
    summary="Сравнить стратегии планирования (S0)",
    responses=error_responses("not_found", "validation"),
    description=(
        "Считает метрики для стратегий `ours` (оптимизатор), `fifo` (базовый вариант) "
        "и `dispatcher` (реальный план диспетчера, если есть данные о назначениях)."
    ),
)
def compare_strategies(
    payload: CompareRequest,
    repository: Repository = Depends(get_repository),
    strategies_service=Depends(get_strategy_service),
) -> CompareResponse:
    """Сравнивает стратегии по обязательным метрикам."""
    scenario = _resolve_scenario(repository, payload.scenario_id)
    base_plan_result = None
    base_plan_payload = None
    if payload.plan_id:
        base_plan = repository.get_plan(payload.plan_id)
        if base_plan is not None:
            base_plan_result = base_plan.result
            base_plan_payload = base_plan.input_payload
    result = strategies_service.compare(
        scenario.engineers,
        scenario.requests,
        strategies=tuple(payload.strategies),
        solver=payload.solver or "hybrid_v2",
        seed=payload.seed if payload.seed is not None else 42,
        total_seconds=payload.time_limit_seconds or 5.0,
        base_plan_result=base_plan_result,
        base_plan_payload=base_plan_payload,
    )
    return CompareResponse(
        region_id=(scenario.scenario_metadata or {}).get("region"),
        columns=result["columns"],
        km_by_engineer=result["km_by_engineer"],
        notes=result["notes"],
    )

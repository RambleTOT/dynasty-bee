"""Сохранение результата перепланирования (версия сценария + план + событие)."""
from __future__ import annotations

from typing import Any

from app.services import day_plan as day_plan_service


def build_algorithm_meta(computation, solver: str, seed: int) -> dict[str, Any]:
    """Собирает метаданные алгоритма для сохранённой версии плана (для будущих событий)."""
    return {
        "solver": solver,
        "seed": seed,
        "elapsed_seconds": round(computation.elapsed, 3),
        "road_factor": computation.problem.road_factor,
        "matrix_sources": computation.problem.matrix_sources,
        "warnings": computation.problem.warnings,
        "algorithm_report": computation.report,
        "solver_metadata": computation.report.get("metadata", {}),
    }


def _engineer_label(engineer_id: Any, names: dict[str, str]) -> str:
    """Имя бригады вместо id, если оно известно."""
    if engineer_id is None:
        return "—"
    return names.get(str(engineer_id), str(engineer_id))


def _headline(event_type: str, payload: dict[str, Any], block: dict[str, Any], names: dict[str, str] | None = None) -> str:
    """Одна строка для ленты диспетчера."""
    names = names or {}
    request_id = payload.get("request_id") or payload.get("order_id")
    engineer_id = payload.get("engineer_id")
    if event_type == "urgent_order_added" and block.get("urgent"):
        urgent = block["urgent"]
        engineer = _engineer_label(urgent.get("engineer_id"), names)
        return f"Авария №{urgent.get('order_id')} → {engineer}, прибытие {urgent.get('arrival')}"
    if event_type == "order_cancelled":
        return f"Отмена №{request_id} подтверждена"
    if event_type == "engineer_unavailable":
        return f"Инженер {_engineer_label(engineer_id, names)} недоступен — заявки переданы другим"
    if event_type == "engineer_available":
        return f"Инженер {_engineer_label(engineer_id, names)} снова доступен"
    if event_type == "engineer_added":
        added = _engineer_label(block.get("engineer_added", {}).get("engineer_id") or engineer_id, names)
        return f"Добавлена бригада {added}"
    if event_type == "transport_changed":
        return (
            f"Инженер {_engineer_label(engineer_id, names)}: "
            f"смена транспорта на {payload.get('transport')}"
        )
    if event_type == "order_added":
        return f"Заявка №{request_id} добавлена"
    if event_type == "engineer_delayed":
        return f"Инженер {_engineer_label(engineer_id, names)}: задержка {payload.get('delay_min')} мин"
    if event_type == "finished_early":
        return f"Инженер {_engineer_label(engineer_id, names)} освободился раньше"
    if event_type == "manual_reassign":
        target = _engineer_label(payload.get("to_engineer_id"), names)
        return f"Ручное переназначение: заявка №{request_id} → {target}"
    if event_type == "extend_resource":
        return "Добор ресурса под неназначенные заявки"
    return f"Событие: {event_type}"


def _next_version(repository, root) -> int:
    """Сквозная нумерация версий в пределах дня (корневого сценария)."""
    return day_plan_service.current_version_seq(repository, root) + 1


def carry_facts(base_plan, api_result: dict[str, Any]) -> None:
    """Переносит факты прежней версии в точки новой (по ``request_id``).

    Статус, ``actual_arrival``/``actual_start``/``actual_end`` сохраняются даже
    если заявка ушла другой бригаде. Требование п. 21.
    """
    facts: dict[str, dict[str, Any]] = {}
    for route in (base_plan.result or {}).get("routes", []):
        for point in route.get("route", []):
            request_id = point.get("request_id")
            if not request_id:
                continue
            fact = {k: point.get(k) for k in ("status", "actual_arrival", "actual_start", "actual_end")}
            if fact.get("status"):
                facts[request_id] = fact
    if not facts:
        return
    for route in api_result.get("routes", []):
        for point in route.get("route", []):
            fact = facts.get(point.get("request_id"))
            if fact:
                point.update(fact)


def activate_plan(repository, plan, version: int, root) -> None:
    """Делает версию действующей: гасит прежнюю и обновляет метаданные дня."""
    if root is None:
        return
    metadata = dict(root.scenario_metadata or {})
    previous_id = metadata.get("active_plan_id")
    if previous_id and previous_id != plan.id:
        previous = repository.get_plan(previous_id)
        if previous is not None and previous.status == "applied":
            previous.status = "superseded"
    metadata["active_plan_id"] = plan.id
    metadata["version"] = version
    root.scenario_metadata = metadata
    repository.update_scenario(root)
    # Дублируем active_plan_id на сценарий самой версии (обратная совместимость).
    if plan.scenario_id:
        scenario = repository.get_scenario(plan.scenario_id)
        if scenario is not None and scenario.id != root.id:
            derived_meta = dict(scenario.scenario_metadata or {})
            derived_meta["active_plan_id"] = plan.id
            derived_meta["version"] = version
            scenario.scenario_metadata = derived_meta
            repository.update_scenario(scenario)


def persist_replan(
    repository,
    base_plan,
    computation,
    *,
    event_type: str,
    event_payload: dict[str, Any],
    status: str,
    solver: str = "hybrid_v2",
    seed: int = 42,
):
    """Сохраняет новую версию сценария, план и событие."""
    base_input = base_plan.input_payload or {}
    root = day_plan_service.for_plan(repository, base_plan)
    # Имя версии не наращиваем цепочкой (иначе Postgres varchar(255) → 500, п. 45):
    # берём имя корневого дня и обрезаем до лимита.
    day_name = (root.name if root is not None and root.name else base_input.get("name", "Сценарий"))
    name = f"{day_name} · после {event_type}"[:255]
    root_id = root.id if root is not None else base_plan.scenario_id
    scenario = repository.create_scenario(
        engineers=computation.engineers,
        requests=computation.requests,
        name=name,
        description=f"Версия после события {event_type}",
        scenario_metadata={
            "derived_from_scenario": base_plan.scenario_id,
            "root_scenario_id": root_id,
            "event_type": event_type,
            "applied_event": event_payload,
            "status": status,
        },
    )
    version = _next_version(repository, root) if status == "applied" else 0
    carry_facts(base_plan, computation.api_result)
    plan = repository.create_plan(
        scenario_id=scenario.id,
        parent_plan_id=base_plan.id,
        input_payload={
            "engineers": computation.engineers,
            "requests": computation.requests,
            "name": name,
        },
        result=computation.api_result,
        metrics=None,
        algorithm_meta=build_algorithm_meta(computation, solver, seed),
        kind="replanned",
        status=status,
    )
    names = {
        str(item.get("id")): str(item.get("name"))
        for item in (computation.engineers or [])
        if item.get("id") and item.get("name")
    }
    stored_payload = {
        **event_payload,
        "headline": _headline(
            event_type,
            {**event_payload, **(event_payload.get("scenario") or {})},
            computation.scenario or {},
            names,
        ),
        "source": event_payload.get("source"),
        "needs_decision": status == "proposed",
    }
    event = repository.create_event(
        event_type=event_type,
        payload=stored_payload,
        plan_id=base_plan.id,
        scenario_id=base_plan.scenario_id,
        result_plan_id=plan.id,
    )
    plan_meta = dict(plan.algorithm_meta or {})
    plan_meta["event_id"] = event.id
    plan_meta["event_type"] = event_type
    plan_meta["headline"] = stored_payload.get("headline")
    plan_meta["version"] = version
    plan.algorithm_meta = plan_meta
    repository.save_plan(plan)
    if status == "applied":
        activate_plan(repository, plan, version, root)
    # Живое обновление: предложение или применённая версия (§38).
    try:
        from app.realtime.hub import hub

        meta = (root.scenario_metadata or {}) if root is not None else {}
        hub.publish(
            "plan.proposed" if status == "proposed" else "plan.applied",
            region_id=meta.get("region_id"),
            date=meta.get("date"),
            data={
                "plan_id": plan.id,
                "parent_plan_id": base_plan.id,
                "event_type": event_type,
                "source": stored_payload.get("source"),
                "order_id": stored_payload.get("request_id") or stored_payload.get("order_id"),
                "engineer_id": stored_payload.get("engineer_id"),
                "version": version or None,
            },
        )
    except Exception:  # noqa: BLE001 — обновления не должны ронять расчёт
        pass
    return event, plan, scenario

"""Разрешение действующего плана дня.

Версии плана после событий сохраняются в производных сценариях, а исходный
сценарий дня хранит ``scenario_metadata.active_plan_id`` и сквозной ``version``.
Модуль централизует поиск действующего плана для всех «читателей дня»
(календарь, кабинет инженера, автопрогон часов, авария оператора).
"""
from __future__ import annotations

from app.storage.models import Plan, Scenario


def root_scenario_id(repository, scenario: Scenario | None) -> str | None:
    """ID исходного сценария дня для любого производного сценария."""
    if scenario is None:
        return None
    visited: set[str] = set()
    current = scenario
    while current is not None and current.id not in visited:
        visited.add(current.id)
        meta = current.scenario_metadata or {}
        root_id = meta.get("root_scenario_id")
        if root_id:
            return root_id
        derived = meta.get("derived_from_scenario")
        if not derived:
            return current.id
        parent = repository.get_scenario(derived)
        if parent is None:
            return current.id
        current = parent
    return scenario.id


def root_scenario(repository, scenario: Scenario | None) -> Scenario | None:
    """Исходный (корневой) сценарий дня."""
    if scenario is None:
        return None
    root_id = root_scenario_id(repository, scenario)
    candidate = repository.get_scenario(root_id) if root_id else None
    return candidate or scenario


def for_plan(repository, plan: Plan | None) -> Scenario | None:
    """Корневой сценарий дня для сохранённого плана."""
    if plan is None or not plan.scenario_id:
        return None
    return root_scenario(repository, repository.get_scenario(plan.scenario_id))


def active_plan(repository, scenario: Scenario | None) -> Plan | None:
    """Действующий (``applied``) план дня: по ``active_plan_id``, затем по статусу."""
    if scenario is None:
        return None
    active_id = (scenario.scenario_metadata or {}).get("active_plan_id")
    if active_id:
        plan = repository.get_plan(active_id)
        if plan is not None and plan.status in {"applied", "completed"}:
            return plan
    plans = repository.list_plans(scenario_id=scenario.id, limit=200)
    return next((p for p in plans if p.status in {"applied", "completed"}), None)


def day_plan(repository, scenario: Scenario | None) -> Plan | None:
    """План, которым живёт день: active → draft → последний сохранённый."""
    if scenario is None:
        return None
    meta = scenario.scenario_metadata or {}
    for key in ("active_plan_id", "draft_plan_id"):
        plan_id = meta.get(key)
        if plan_id:
            plan = repository.get_plan(plan_id)
            if plan is not None:
                return plan
    # последний сохранённый — кроме погашенных и отклонённых: у дня без заявок плана нет (п. 39)
    plans = repository.list_plans(scenario_id=scenario.id, limit=20)
    return next((plan for plan in plans if plan.status not in {"superseded", "rejected"}), None)


def pending_proposals(repository, base: Plan | None) -> list[Plan]:
    """Предложения, построенные от действующей версии (для баннера/ленты)."""
    if base is None:
        return []
    return [p for p in repository.child_plans(base.id) if p.status == "proposed"]


def current_version_seq(repository, root: Scenario | None) -> int:
    """Действующий номер версии дня (для нумерации при `/apply`)."""
    if root is None:
        return 0
    metadata = root.scenario_metadata or {}
    seq = int(metadata.get("version") or 0)
    for plan in repository.list_plans(scenario_id=root.id, limit=500):
        if plan.status in {"applied", "completed"}:
            seq = max(seq, int((plan.algorithm_meta or {}).get("version", 0) or 0))
    active = active_plan(repository, root)
    if active is not None:
        seq = max(seq, int((active.algorithm_meta or {}).get("version", 0) or 0))
    return seq

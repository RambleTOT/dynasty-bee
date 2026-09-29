"""Перепланирование остатка дня от фактического состояния бригад, а не от планового времени."""
from __future__ import annotations
from dataclasses import dataclass, replace
import numpy as np
from .model import Instance
from .evaluate import Evaluator
from .search import solve, SearchConfig


@dataclass(frozen=True)
class EngineerState:
    """Фактическое состояние бригады в момент события."""
    engineer_id: str
    # Где бригада сейчас, а если занята — где закончит текущую работу.
    start_node: int
    available_at: int
    used_today: bool
    available: bool = True
    committed_task_ids: tuple[str, ...] = ()
    locked_future_prefix: tuple[str, ...] = ()
    actually_travelled_m: int = 0


def residual_problem(updated_instance: Instance, previous_report: dict, event_time: int,
                     states: list[EngineerState], completed_ids: set[str], cancelled_ids: set[str] | None = None):
    """Задача на остаток дня и стартовый план из прошлых маршрутов.

    updated_instance уже содержит новые заявки и актуальные матрицы.
    committed_task_ids — работы, которые уже не изменятся; их окончание учтено
    в available_at и start_node. Отменить такую работу здесь нельзя: прерванная
    работа — отдельное действие диспетчера с новой заявкой.
    """
    cancelled_ids = set(cancelled_ids or ())
    if event_time < 0:
        raise ValueError('Invalid event time')
    state = {s.engineer_id: s for s in states}
    if len(state) != len(states) or set(state) != {e.id for e in updated_instance.engineers}:
        raise ValueError('Explicit telemetry is required exactly once for every engineer')
    known = {t.id for t in updated_instance.tasks}
    committed_list = [tid for s in states for tid in s.committed_task_ids]
    if len(committed_list) != len(set(committed_list)):
        raise ValueError('A task is committed to multiple engineers')
    committed = set(committed_list)
    if not (completed_ids | committed | cancelled_ids).issubset(known):
        raise ValueError('Unknown completed/committed/cancelled task')
    if (completed_ids & committed) or (cancelled_ids & (committed | completed_ids)):
        raise ValueError('Conflicting task states; committed/completed tasks cannot be cancelled here')
    if any(s.available_at < 0 or s.actually_travelled_m < 0 for s in states):
        raise ValueError('Invalid telemetry time/distance')
    retained = [i for i, t in enumerate(updated_instance.tasks)
                if t.id not in (completed_ids | committed | cancelled_ids)]
    tasks = [updated_instance.tasks[i] for i in retained]
    retained_ids = {t.id for t in tasks}
    engineers = []
    for e in updated_instance.engineers:
        s = state[e.id]
        if s.committed_task_ids and s.available_at < event_time:
            raise ValueError('Committed work cannot have an availability time before the event')
        if not set(s.locked_future_prefix).issubset(retained_ids):
            raise ValueError('Locked future task is not in the remaining problem')
        available = s.available and max(event_time, s.available_at) <= e.shift_end
        start = min(e.shift_end, max(e.shift_start, event_time, s.available_at))
        if not available and s.locked_future_prefix:
            raise ValueError('Unavailable engineer has locked future work; release or resolve it explicitly')
        engineers.append(replace(e, start_node=s.start_node, shift_start=start,
                                 used_today=s.used_today or bool(s.committed_task_ids),
                                 available=available, locked_prefix=s.locked_future_prefix))
    previous_assignment, previous_predecessor = {}, {}
    old_lists = {}
    for route in previous_report['routes']:
        ids = [tid for tid in route['task_ids'] if tid in retained_ids]
        old_lists[route['engineer_id']] = ids
        predecessor = None
        for tid in ids:
            previous_assignment[tid] = route['engineer_id']
            previous_predecessor[tid] = predecessor
            predecessor = tid
    service = updated_instance.service_by_engineer
    if service is not None:
        service = service[:, retained]
    residual = Instance(tasks, engineers, updated_instance.travel_minutes, updated_instance.distance_m,
                        service, previous_assignment, previous_predecessor,
                        {**updated_instance.metadata, 'event_time': event_time,
                         'actual_completed_ids': sorted(completed_ids),
                         'immutable_committed_ids': sorted(committed),
                         'cancelled_ids': sorted(cancelled_ids),
                         'actually_travelled_distance_m': sum(s.actually_travelled_m for s in states)})
    ev = Evaluator(residual)
    indices = {t.id: i for i, t in enumerate(tasks)}
    warm = []
    for k, e in enumerate(engineers):
        route = tuple(indices[tid] for tid in old_lists.get(e.id, []))
        warm.append(route if ev.route(k, route)[0] else ev.a.locked[k])
    # Проверяем замороженное до поиска, чтобы не сломать его молча.
    ev.key(warm)
    return residual, warm


def plan_changes(previous_report: dict, current_report: dict):
    """Какие заявки сменили инженера или позицию."""
    before = {tid: (r['engineer_id'], pos)
              for r in previous_report['routes'] for pos, tid in enumerate(r['task_ids'])}
    after = {tid: (r['engineer_id'], pos)
             for r in current_report['routes'] for pos, tid in enumerate(r['task_ids'])}
    changes = []
    remaining_ids = set(after) | {r['task_id'] for r in current_report['unassigned']}
    for tid in sorted(remaining_ids):
        old, new = before.get(tid), after.get(tid)
        if old != new:
            changes.append({'task_id': tid, 'before': old, 'after': new,
                            'kind': 'unassigned' if new is None else 'newly_assigned' if old is None
                            else 'reassigned' if old[0] != new[0] else 'position_changed'})
    return changes


def replan(updated_instance, previous_report, event_time, states, completed_ids,
           cancelled_ids=None, config: SearchConfig | None = None):
    """Перепланирует остаток дня поиском ALNS, стартуя с прошлого плана."""
    residual, warm = residual_problem(updated_instance, previous_report, event_time, states,
                                      set(completed_ids), cancelled_ids)
    result = solve(residual, config, initial_routes=warm)
    result.report['changes'] = plan_changes(previous_report, result.report)
    result.report['metadata']['replanning'] = {'actual_state_required': True,
        'completed_tasks_rescheduled': False, 'committed_tasks_rescheduled': False,
        'note': 'Position indices may change after completed/cancelled work is removed; use the task lists to display true resequencing.'}
    result.report['actual_plus_future_distance_km'] = (residual.metadata['actually_travelled_distance_m']/1000
                                                     + result.report['future_distance_km'])
    return residual, result


def replan_production(updated_instance, previous_report, event_time, states, completed_ids,
                      cancelled_ids=None, production_config=None):
    """То же через основной планировщик. Поиск стартует с текущего плана, а не с нуля."""
    from .production import solve_production, ProductionConfig
    residual, warm = residual_problem(updated_instance, previous_report, event_time, states,
                                      set(completed_ids), cancelled_ids)
    cfg = production_config or ProductionConfig(total_seconds=6.0, warm_iterations=120,
                                                 master_seconds=1.0, cg_seconds=2.2)
    result = solve_production(residual, cfg, initial_routes=warm)
    result.report['changes'] = plan_changes(previous_report, result.report)
    result.report['metadata']['replanning'] = {
        'solver': 'production_hybrid', 'actual_state_required': True,
        'completed_tasks_rescheduled': False, 'committed_tasks_rescheduled': False,
        'warm_started_from_previous_plan': True,
        'note': 'Only the remaining day is optimized; completed/committed work is immutable.'}
    result.report['actual_plus_future_distance_km'] = (residual.metadata['actually_travelled_distance_m']/1000
                                                     + result.report['future_distance_km'])
    return residual, result

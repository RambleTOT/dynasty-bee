"""Независимый валидатор плана.

Намеренно не использует код поиска: маршруты проигрываются заново, с нуля.
Поэтому валидатор работает как отдельная страховка и как понятный список
всех нарушений в ручном или чужом плане.
"""
from __future__ import annotations

import numpy as np

from .model import Instance


def _skill_level(engineer, task) -> int:
    return dict(engineer.skill_levels).get(task.skill, 1 if task.skill in engineer.skills else 0)


def constraint_violations(instance: Instance, routes) -> list[dict]:
    """Все найденные нарушения. Пустой список — план допустим."""
    try:
        instance.validate()
    except Exception as exc:
        return [{'code': 'INVALID_INSTANCE', 'message': str(exc)}]

    out: list[dict] = []
    if len(routes) != len(instance.engineers):
        out.append({'code': 'ROUTE_COUNT', 'message': 'Wrong number of routes',
                    'expected': len(instance.engineers), 'actual': len(routes)})
        # Продолжаем по общей части — так видно больше ошибок сразу.

    seen: dict[int, str] = {}
    for k, (e, route) in enumerate(zip(instance.engineers, routes)):
        now, prev = e.shift_start, e.start_node
        ids = []
        for pos, i in enumerate(route):
            if not isinstance(i, (int, np.integer)) or not 0 <= int(i) < len(instance.tasks):
                out.append({'code': 'INVALID_TASK_INDEX', 'engineer_id': e.id,
                            'position': pos, 'task_index': repr(i)})
                continue
            i = int(i)
            task = instance.tasks[i]
            ids.append(task.id)

            if i in seen:
                out.append({'code': 'DUPLICATE', 'request_id': task.id, 'engineer_id': e.id,
                            'first_engineer_id': seen[i]})
                continue
            seen[i] = e.id

            # Совместимость инженера и заявки.
            level = _skill_level(e, task)
            if not e.available:
                out.append({'code': 'ENGINEER_UNAVAILABLE', 'engineer_id': e.id,
                            'request_id': task.id})
            if level < task.min_skill_level:
                out.append({'code': 'NO_SKILL', 'engineer_id': e.id, 'request_id': task.id,
                            'required_skill': task.skill, 'required_level': task.min_skill_level,
                            'actual_level': level})
            if task.transport is not None and task.transport != e.transport:
                out.append({'code': 'NO_TRANSPORT', 'engineer_id': e.id, 'request_id': task.id,
                            'required': task.transport, 'actual': e.transport})
            missing_tools = sorted(set(task.required_tools) - set(e.tools))
            if missing_tools:
                out.append({'code': 'NO_EQUIPMENT', 'engineer_id': e.id, 'request_id': task.id,
                            'missing_tools': missing_tools})

            # Время: окно начала и конец смены.
            arrive = now + int(instance.travel_minutes[e.transport][prev, task.node])
            start = max(arrive, task.window_start, task.release_time)
            if start > task.window_end:
                out.append({'code': 'WINDOW', 'engineer_id': e.id, 'request_id': task.id,
                            'arrival_minute': arrive, 'start_minute': start,
                            'window_end': task.window_end})
            if instance.service_by_engineer is None:
                duration = task.duration
            else:
                duration = int(instance.service_by_engineer[k, i])
            now = start + duration
            if now > e.shift_end:
                out.append({'code': 'SHIFT', 'engineer_id': e.id, 'request_id': task.id,
                            'end_minute': now, 'shift_end': e.shift_end})
            prev = task.node

        prefix = tuple(ids[:len(e.locked_prefix)])
        if prefix != e.locked_prefix:
            out.append({'code': 'FROZEN', 'engineer_id': e.id,
                        'expected_prefix': list(e.locked_prefix), 'actual_prefix': list(prefix)})
    return out


def validate_plan(instance: Instance, routes):
    """Бросает ValueError при первом нарушении, иначе возвращает целевой вектор плана."""
    violations = constraint_violations(instance, routes)
    if violations:
        first = violations[0]
        raise ValueError(f"{first['code']}: {first}")

    total_distance = 0
    for e, route in zip(instance.engineers, routes):
        prev = e.start_node
        for i in route:
            total_distance += int(instance.distance_m[e.transport][prev, instance.tasks[i].node])
            prev = instance.tasks[i].node

    seen = {i for r in routes for i in r}
    missing = set(range(len(instance.tasks))) - seen
    by_rank = tuple(
        sum((1 if instance.tasks[i].urgent else instance.tasks[i].priority_rank) == rank
            for i in missing)
        for rank in (1, 2, 3))
    active = sum(bool(r) or e.used_today for r, e in zip(routes, instance.engineers))

    soft = 0
    for route in routes:
        zones = [instance.tasks[i].zone for i in route if instance.tasks[i].zone]
        switches = sum(a != b for a, b in zip(zones, zones[1:]))
        soft += max(0, switches - 1)

    return (*map(int, by_rank), int(active), int(total_distance), int(soft))

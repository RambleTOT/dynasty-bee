"""Перевод JSON бэкенда (`Problem`) в модель оптимизатора и отчёта — обратно в ответ API."""
from __future__ import annotations

from typing import Any

import numpy as np

from .model import Engineer, Instance, Task, minutes

FROZEN_STATUSES = {'done', 'completed', 'in_progress', 'en_route'}


def _skill_from_request(r: dict[str, Any]) -> str:
    if r.get('required_skill'):
        return str(r['required_skill'])
    bk = str(r.get('type_bk', '')).lower()
    if 'глоб' in bk or 'авар' in bk:
        return 'emergency'
    if 'подключ' in bk or 'дозаказ' in bk:
        return 'installation'
    return 'local'


def _priority_rank(r: dict[str, Any]) -> int:
    """1 — авария, 2 — подключение, 3 — остальное."""
    if r.get('priority_rank') is not None:
        return int(r['priority_rank'])
    if r.get('priority') == 'urgent':
        return 1
    bk = str(r.get('type_bk', '')).strip().casefold()
    hd = str(r.get('type_hd', '')).strip().casefold()
    if 'глоб' in bk or 'авар' in bk or hd == 'авария':
        return 1
    if 'подключ' in bk:
        return 2
    if 'дозаказ' in bk or 'локаль' in bk:
        return 3
    # Запрос без исходного типа BK — определяем по навыку.
    skill = _skill_from_request(r)
    return 1 if skill == 'emergency' else 2 if skill == 'installation' else 3


def _locked_from_current_plan(problem: dict[str, Any]) -> dict[str, tuple[str, ...]]:
    """Замороженное начало маршрутов из живого плана.

    Выполненные, начатые и визиты «в пути» не меняются при перепланировании.
    """
    locked_by_engineer: dict[str, tuple[str, ...]] = {}
    current_plan = problem.get('current_plan') or {}
    for route in current_plan.get('routes', []):
        locked = []
        for v in route.get('visits', []):
            frozen = bool(v.get('frozen')) or str(v.get('status', '')).lower() in FROZEN_STATUSES
            if not frozen:
                break
            rid = v.get('request_id')
            if rid is not None:
                locked.append(str(rid))
        locked_by_engineer[str(route.get('engineer_id'))] = tuple(locked)
    return locked_by_engineer


def _check_same_section(items, site_id, kind: str) -> None:
    """Назначения между участками запрещены: всё в Problem должно быть с одного участка."""
    for item in items:
        item_site = item.get('section_id') or item.get('site_id')
        if site_id is not None and item_site is not None and str(item_site) != site_id:
            raise ValueError(f'{kind} {item.get("id")} belongs to another section: '
                             f'{item_site} != {site_id}')


def instance_from_problem(problem: dict[str, Any]) -> Instance:
    """JSON `Problem` от бэкенда → Instance.

    Геокодирование и матрицы движения — на стороне бэкенда.
    Один Problem — один участок, поэтому назначить заявку на чужой участок нельзя.
    """
    reqs = problem.get('requests', problem.get('tasks', []))
    engs = problem.get('engineers', [])

    tasks = []
    for r in reqs:
        rank = _priority_rank(r)
        tasks.append(Task(
            id=str(r['id']),
            node=int(r['node']),
            duration=int(r.get('duration_minutes', r.get('duration', 0))),
            window_start=minutes(r['window_start']),
            window_end=minutes(r['window_end']),
            skill=_skill_from_request(r),
            transport=r.get('required_transport'),
            urgent=rank == 1,
            release_time=minutes(r.get('release_time', 0)),
            min_skill_level=int(r.get('min_skill_level', 1)),
            required_tools=tuple(r.get('required_tools', [])),
            priority_rank=rank,
            type_bk=r.get('type_bk'),
            type_hd=r.get('type_hd'),
            zone=r.get('zone'),
        ))

    site_id = str(problem.get('section_id') or problem.get('site_id')
                  or problem.get('region_id') or '') or None
    derived_locked = _locked_from_current_plan(problem)
    _check_same_section(reqs, site_id, 'Request')
    _check_same_section(engs, site_id, 'Engineer')

    engineers = []
    for e in engs:
        eid = str(e['id'])
        locked = tuple(e.get('locked_prefix', derived_locked.get(eid, ())))
        has_locked = bool(e.get('locked_prefix', [])) or bool(derived_locked.get(eid, ()))
        engineers.append(Engineer(
            id=eid,
            start_node=int(e['start_node']),
            shift_start=minutes(e['shift_start']),
            shift_end=minutes(e['shift_end']),
            skills=tuple(e.get('skills', [])),
            transport=str(e['transport']),
            used_today=bool(e.get('used_today', has_locked)),
            available=bool(e.get('available', True)),
            locked_prefix=locked,
            skill_levels=tuple((str(k), int(v)) for k, v in e.get('skill_levels', [])),
            tools=tuple(e.get('tools', [])),
            site_id=site_id,
            home_zone=e.get('zone'),
        ))

    travel = problem.get('travel', {})
    tmin = travel.get('minutes', problem.get('travel_minutes'))
    km = travel.get('km')
    if km is not None:
        dist = {k: [[int(round(float(x) * 1000)) for x in row] for row in a] for k, a in km.items()}
    else:
        dist = problem.get('distance_m')
    if tmin is None or dist is None:
        raise ValueError('Backend must provide travel.minutes and travel.km/distance_m')

    meta = dict(problem.get('metadata', {}))
    meta.update({'scenario_id': problem.get('scenario_id'), 'site_id': site_id,
                 'date': problem.get('date'), 'params': problem.get('params', {})})
    inst = Instance(tasks, engineers,
                    {k: np.asarray(v) for k, v in tmin.items()},
                    {k: np.asarray(v) for k, v in dist.items()},
                    metadata=meta)
    inst.validate()
    return inst


def report_to_solution(report: dict[str, Any]) -> dict[str, Any]:
    """Внутренний отчёт → стабильный формат ответа для бэкенда."""
    routes = []
    for route in report.get('routes', []):
        schedule = route.get('schedule', [])
        visits = [{
            'request_id': row['task_id'],
            'sequence': seq,
            'arrival': row['arrival'], 'start': row['start'], 'end': row['end'],
            'travel_minutes': row['travel_minutes'],
            'leg_km': row['leg_metres'] / 1000,
            'waiting_minutes': row['waiting_minutes'],
            'slack_minutes': row['window_slack_minutes'],
            'flags': [],
            'frozen': False,
        } for seq, row in enumerate(schedule, 1)]
        routes.append({
            'engineer_id': route['engineer_id'],
            'visits': visits,
            'km': route['distance_km'],
            'travel_minutes': route.get('travel_minutes', 0),
            'service_minutes': sum(v['end_minute'] - v['start_minute'] for v in schedule),
            'waiting_minutes': sum(v['waiting_minutes'] for v in schedule),
            'first_start': visits[0]['start'] if visits else None,
            'last_end': visits[-1]['end'] if visits else None,
        })
    return {
        'status': 'ok',
        'strategy': 'ours',
        'routes': routes,
        'unassigned': report.get('unassigned', []),
        'objective': report.get('objective', []),
        'violations': report.get('violations', []),
        'decision': report.get('decision'),
        'meta': report.get('metadata', {}),
    }

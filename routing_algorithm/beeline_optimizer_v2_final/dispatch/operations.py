"""Операции для бэкенда и сценариев BPMN: план, FIFO, события дня, проверки.

Все операции используют тот же расчёт маршрутов и тот же валидатор, что и `plan`,
поэтому базовый вариант, ручные проверки и события не расходятся в правилах.
"""
from __future__ import annotations

from copy import deepcopy
from dataclasses import replace
from typing import Any, Iterable

import numpy as np

from .evaluate import Evaluator, baseline
from .model import Engineer, Instance, Task, clock
from .production import ProductionConfig, solve_production
from .validation import constraint_violations

Routes = list[tuple[int, ...]]


# --- вспомогательное ------------------------------------------------------

def _routes_from_report(instance: Instance, report: dict[str, Any]) -> Routes:
    """Маршруты из JSON-отчёта → индексы заявок. Заявки, которых нет в instance, пропускаются."""
    idx = {t.id: i for i, t in enumerate(instance.tasks)}
    by_eng = {r['engineer_id']: r for r in report.get('routes', [])}
    out = []
    for e in instance.engineers:
        r = by_eng.get(e.id, {})
        ids = r.get('task_ids')
        if ids is None:
            ids = [v['request_id'] for v in r.get('visits', [])]
        out.append(tuple(idx[x] for x in ids if x in idx))
    return out


def _engineer_index(instance: Instance, engineer_id: str) -> int:
    return next(k for k, e in enumerate(instance.engineers) if e.id == engineer_id)


def _by_priority(instance: Instance, indices: Iterable[int]) -> list[int]:
    """Сначала аварии, потом подключения, потом остальное; внутри — по началу окна."""
    return sorted(indices, key=lambda i: (instance.tasks[i].priority_rank,
                                          instance.tasks[i].window_start))


def _place(routes: Routes, best: dict, i: int) -> int:
    """Вставляет заявку i по результату best_insertion. Возвращает индекс инженера."""
    k, p = best['engineer_index'], best['position']
    routes[k] = routes[k][:p] + (i,) + routes[k][p:]
    return k


def _finish(instance: Instance, routes: Routes, current_report: dict, meta: dict) -> dict:
    """Отчёт после события: план, нарушения и что изменилось."""
    report = Evaluator(instance).report(routes, meta)
    report['violations'] = check_constraints(instance, routes)
    report['plan_diff'] = diff(current_report, report)
    return report


# --- план, FIFO, метрики -------------------------------------------------

def check_constraints(instance: Instance, routes: Routes) -> list[dict[str, Any]]:
    """Независимый валидатор. Пустой список — план допустим."""
    return constraint_violations(instance, routes)


def metrics(instance: Instance, routes: Routes) -> dict[str, Any]:
    """Главные метрики плана для интерфейса и сравнения."""
    report = Evaluator(instance).report(routes)
    return {
        'engineers_used': report['active_engineers_today'],
        'km_total': report['future_distance_km'],
        'km_by_engineer': {r['engineer_id']: r['distance_km'] for r in report['routes']},
        'coverage_pct': report['coverage_pct'],
        'planned_count': report['planned_count'],
        'total_requests': len(instance.tasks),
        'unassigned_count': report['unassigned_count'],
        'unassigned_urgent': report['unassigned_rank1'],
        'unassigned_installation': report['unassigned_rank2'],
        'violations': len(check_constraints(instance, routes)),
        'travel_minutes': report['future_travel_minutes'],
    }


def plan(instance: Instance, config: ProductionConfig | None = None):
    """Строит план на день. Отчёт — в result.report."""
    result = solve_production(instance, config)
    result.report['violations'] = check_constraints(instance, result.routes)
    result.report['metrics'] = metrics(instance, result.routes)
    return result


def baseline_fifo(instance: Instance) -> dict[str, Any]:
    """Базовый FIFO из условия кейса — для сравнения на тех же заявках."""
    routes = baseline(instance)
    report = Evaluator(instance).report(routes, {'algorithm': 'FIFO baseline from case specification'})
    report['violations'] = check_constraints(instance, routes)
    report['metrics'] = metrics(instance, routes)
    return {'routes_raw': routes, 'report': report}


def diff(old: dict[str, Any], new: dict[str, Any]) -> dict[str, Any]:
    """Что изменилось между двумя версиями плана."""
    def positions(report):
        out = {}
        for r in report.get('routes', []):
            ids = r.get('task_ids') or [v['request_id'] for v in r.get('visits', [])]
            for pos, tid in enumerate(ids):
                out[tid] = (r['engineer_id'], pos)
        return out

    a, b = positions(old), positions(new)
    changes = []
    for tid in sorted(set(a) | set(b)):
        before, after = a.get(tid), b.get(tid)
        if before == after:
            continue
        if before is None:
            kind = 'newly_assigned'
        elif after is None:
            kind = 'removed_or_unassigned'
        elif before[0] != after[0]:
            kind = 'reassigned'
        else:
            kind = 'reordered'
        changes.append({'request_id': tid, 'kind': kind, 'before': before, 'after': after})
    return {'changes': changes, 'changed_count': len(changes),
            'objective_before': old.get('objective'), 'objective_after': new.get('objective')}


# --- вставка новых заявок ------------------------------------------------

def best_insertion(instance: Instance, routes: Routes, task_index: int,
                   engineer_indices: Iterable[int] | None = None):
    """Лучшее место для заявки без перестройки остального плана.

    Критерии: не открывать нового инженера → меньше км → больше запас.
    Возвращает dict или None, если места нет.
    """
    ev = Evaluator(instance)
    candidates = range(len(routes)) if engineer_indices is None else list(engineer_indices)
    best = None
    for k in candidates:
        pos, dist, end, slack = ev.insert(k, routes[k], task_index)
        if pos < 0:
            continue
        delta = int(dist - ev.route(k, routes[k])[1])
        opens = int(not routes[k] and not instance.engineers[k].used_today)
        cost = (opens, delta, -int(slack), k, int(pos), int(end))
        if best is None or cost < best['cost']:
            best = {'cost': cost, 'engineer_index': k, 'position': int(pos),
                    'delta_m': delta, 'new_end': int(end), 'slack': int(slack)}
    return best


def insert(instance: Instance, current_report: dict[str, Any], request_ids: list[str]):
    """Добавляет новые обычные заявки в свободные места. Порядок остальных не меняется."""
    routes = _routes_from_report(instance, current_report)
    idx = {t.id: i for i, t in enumerate(instance.tasks)}
    order = sorted((idx[x] for x in request_ids if x in idx),
                   key=lambda i: (instance.tasks[i].priority_rank,
                                  instance.tasks[i].window_start,
                                  instance.tasks[i].window_end,
                                  instance.tasks[i].id))
    inserted, not_inserted = [], []
    for i in order:
        if any(i in r for r in routes):
            continue
        best = best_insertion(instance, routes, i)
        if best is None:
            not_inserted.append(instance.tasks[i].id)
            continue
        k = _place(routes, best, i)
        inserted.append({'request_id': instance.tasks[i].id,
                         'engineer_id': instance.engineers[k].id,
                         'position': best['position'],
                         'delta_km': best['delta_m'] / 1000})
    report = Evaluator(instance).report(routes, {'operation': 'insert'})
    report['inserted'] = inserted
    report['not_inserted'] = not_inserted
    report['violations'] = check_constraints(instance, routes)
    return routes, report


def check_slots(instance: Instance, task: Task, windows: list[tuple[int, int]], routes=None):
    """Для оператора: в какие из предложенных окон заявка сейчас помещается."""
    base_routes = list(routes or [tuple() for _ in instance.engineers])
    out = []
    for start, end in windows:
        probe = replace(task, window_start=start, window_end=end)
        tasks = list(instance.tasks) + [probe]
        service = None
        if instance.service_by_engineer is not None:
            service = np.c_[instance.service_by_engineer,
                            np.full(len(instance.engineers), probe.duration, dtype=int)]
        tmp = Instance(tasks, instance.engineers, instance.travel_minutes, instance.distance_m,
                       service, instance.previous_assignment, instance.previous_predecessor,
                       instance.metadata)
        best = best_insertion(tmp, base_routes, len(tasks) - 1)
        out.append({
            'window': f'{clock(start)}-{clock(end)}',
            'available': best is not None,
            'engineer_id': None if best is None else tmp.engineers[best['engineer_index']].id,
            'delta_km': None if best is None else best['delta_m'] / 1000,
            'reason_code': None if best is not None else 'NO_CAPACITY',
        })
    return out


# --- оценка чужого плана -------------------------------------------------

def evaluate_assignment(instance: Instance, assignment: dict[str, str]) -> dict[str, Any]:
    """Оценивает готовое распределение диспетчера {заявка: инженер}.

    Порядок визитов неизвестен, поэтому он оценочный: раньше окно — раньше визит,
    при равных окнах — ближайшая точка. Нарушения не скрываются.
    """
    ev = Evaluator(instance)
    tidx = {t.id: i for i, t in enumerate(instance.tasks)}
    eidx = {e.id: k for k, e in enumerate(instance.engineers)}
    buckets = [[] for _ in instance.engineers]
    for tid, eid in assignment.items():
        if tid in tidx and eid in eidx:
            buckets[eidx[eid]].append(tidx[tid])

    routes, violations = [], []
    for k, items in enumerate(buckets):
        engineer = instance.engineers[k]
        dist = instance.distance_m[engineer.transport]
        route, remaining = [], set(items)
        prev = engineer.start_node
        while remaining:
            i = min(remaining, key=lambda x: (instance.tasks[x].window_start,
                                              int(dist[prev, instance.tasks[x].node]),
                                              instance.tasks[x].id))
            route.append(i)
            remaining.remove(i)
            prev = instance.tasks[i].node
        r = tuple(route)
        if not ev.route(k, r)[0]:
            violations.append({'engineer_id': engineer.id, 'code': 'DISPATCHER_ROUTE_INFEASIBLE'})
        routes.append(r)

    # Километры считаем напрямую: у исторического плана могут быть нарушения.
    km = 0.0
    for k, r in enumerate(routes):
        e = instance.engineers[k]
        prev = e.start_node
        for i in r:
            km += float(instance.distance_m[e.transport][prev, instance.tasks[i].node]) / 1000
            prev = instance.tasks[i].node
    return {'strategy': 'dispatcher', 'routes_raw': routes, 'km_total': km,
            'km_is_estimate': True, 'violations': violations,
            'note': 'Порядок визитов оценочный: в контрольной выгрузке его нет.'}


# --- события дня ---------------------------------------------------------

def _candidate_route_with_urgent(ev: Evaluator, routes, k: int, urgent_i: int, event_time: int):
    """Ставит аварию инженеру k сразу после текущей работы.

    Если хвост перестал помещаться, снимает самые неважные заявки
    (сначала ранг 3, потом 2; при равенстве — более длинные).
    Начатые работы и саму аварию не трогает.
    Возвращает (маршрут, снятые заявки, строка расписания аварии) или None.
    """
    route = routes[k]
    schedule = ev.schedule(k, route) if route else []
    fixed = len(ev.a.locked[k])
    for pos, row in enumerate(schedule):
        done_or_running = (row['end_minute'] <= event_time
                           or row['start_minute'] <= event_time < row['end_minute'])
        if done_or_running:
            fixed = pos + 1
        elif row['start_minute'] > event_time:
            break

    candidate = route[:fixed] + (urgent_i,) + route[fixed:]
    displaced = []
    while not ev.route(k, candidate)[0]:
        movable = [(pos, i) for pos, i in enumerate(candidate) if pos > fixed and i != urgent_i]
        if not movable:
            return None
        pos, victim = max(movable, key=lambda x: (ev.instance.tasks[x[1]].priority_rank,
                                                  ev.instance.tasks[x[1]].duration,
                                                  x[0]))
        displaced.append(victim)
        candidate = candidate[:pos] + candidate[pos + 1:]

    urgent_row = ev.schedule(k, candidate)[candidate.index(urgent_i)]
    return candidate, displaced, urgent_row


def handle_urgent(instance: Instance, current_report: dict[str, Any], urgent_request_id: str,
                  event_time: int, reaction_minutes: int = 120) -> dict[str, Any]:
    """Авария в течение дня.

    Кандидаты — доступные инженеры с нужным навыком и транспортом. Текущая работа
    не прерывается. Выбирается самое раннее начало, при равенстве — меньше снятых
    заявок. Снятые заявки пробуем отдать другим инженерам.
    """
    routes = _routes_from_report(instance, current_report)
    ev = Evaluator(instance)
    idx = {t.id: i for i, t in enumerate(instance.tasks)}
    if urgent_request_id not in idx:
        raise ValueError('Urgent request must already be present in updated instance')
    u = idx[urgent_request_id]
    if instance.tasks[u].priority_rank != 1:
        raise ValueError('handle_urgent requires priority_rank=1')

    candidates = []
    for k in range(len(instance.engineers)):
        if not ev.a.allowed[k, u]:
            continue
        trial = _candidate_route_with_urgent(ev, routes, k, u, event_time)
        if trial is None:
            continue
        route, displaced, row = trial
        candidates.append((row['start_minute'], len(displaced), row['travel_minutes'], k,
                           route, displaced, row))
    if not candidates:
        return {'status': 'unassigned', 'request_id': urgent_request_id,
                'reason': ev.explain_unassigned(u, routes)}

    candidates.sort(key=lambda x: x[:4])
    _, _, _, k, new_route, displaced, row = candidates[0]
    routes[k] = new_route

    reassigned, lost = [], []
    for i in _by_priority(instance, displaced):
        best = best_insertion(instance, routes, i)
        if best is None:
            lost.append(instance.tasks[i].id)
            continue
        b = _place(routes, best, i)
        reassigned.append({'request_id': instance.tasks[i].id,
                           'to_engineer_id': instance.engineers[b].id})

    report = ev.report(routes, {'operation': 'handle_urgent', 'event_time': event_time})
    report['violations'] = check_constraints(instance, routes)
    report['decision'] = {
        'engineer_id': instance.engineers[k].id,
        'rule': 'min_arrival_after_current_work',
        'arrival': row['arrival'],
        'start': row['start'],
        'reaction_minutes': max(0, int(row['start_minute']) - event_time),
        'reaction_late': int(row['start_minute']) > event_time + reaction_minutes,
        'displaced': [instance.tasks[i].id for i in displaced],
        'reassigned': reassigned,
        'unassigned': lost,
        'alternatives': [{'engineer_id': instance.engineers[x[3]].id, 'start': x[6]['start']}
                         for x in candidates[1:4]],
    }
    report['plan_diff'] = diff(current_report, report)
    return report


def handle_cancel(instance: Instance, current_report: dict[str, Any], cancelled_request_id: str):
    """Отмена заявки. instance — уже обновлённый день (отменённой заявки там может не быть).

    Освободившееся время заполняем заявками без исполнителя, по приоритету.
    """
    routes = _routes_from_report(instance, current_report)
    missing = [i for i in range(len(instance.tasks)) if not any(i in r for r in routes)]
    for i in _by_priority(instance, missing):
        best = best_insertion(instance, routes, i)
        if best:
            _place(routes, best, i)
    return _finish(instance, routes, current_report,
                   {'operation': 'handle_cancel', 'cancelled_request_id': cancelled_request_id})


def handle_engineer_unavailable(instance: Instance, current_report: dict[str, Any], engineer_id: str):
    """Инженер выбыл. В instance он уже помечен недоступным.

    Начатые визиты остаются за ним, остальное пробуем раздать другим.
    """
    routes = _routes_from_report(instance, current_report)
    k = _engineer_index(instance, engineer_id)
    locked_n = len(Evaluator(instance).a.locked[k])
    released = list(routes[k][locked_n:])
    routes[k] = routes[k][:locked_n]
    others = [j for j in range(len(routes)) if j != k]

    lost = []
    for i in _by_priority(instance, released):
        best = best_insertion(instance, routes, i, others)
        if best is None:
            lost.append(instance.tasks[i].id)
            continue
        _place(routes, best, i)

    report = Evaluator(instance).report(routes, {'operation': 'handle_engineer_unavailable',
                                                 'engineer_id': engineer_id})
    report['event_unassigned'] = lost
    report['violations'] = check_constraints(instance, routes)
    report['plan_diff'] = diff(current_report, report)
    return report


def handle_engineer_available(instance: Instance, current_report: dict[str, Any], engineer_id: str):
    """Инженер вернулся: пробуем поставить заявки, которые были без исполнителя."""
    missing = [x['task_id'] for x in current_report.get('unassigned', [])]
    return insert(instance, current_report, missing)[1]


def handle_transport_changed(instance: Instance, current_report: dict[str, Any], engineer_id: str):
    """Инженер сменил транспорт. В instance уже указан новый.

    Заявки, которые с новым транспортом нельзя или не успеть, раздаём другим.
    """
    routes = _routes_from_report(instance, current_report)
    k = _engineer_index(instance, engineer_id)
    ev = Evaluator(instance)
    locked_n = len(ev.a.locked[k])

    keep, released = list(routes[k][:locked_n]), []
    for i in routes[k][locked_n:]:
        (keep if ev.a.allowed[k, i] else released).append(i)
    routes[k] = tuple(keep)
    # Если по новой матрице хвост не успевается, снимаем с конца.
    while routes[k] and not ev.route(k, routes[k])[0]:
        released.append(routes[k][-1])
        routes[k] = routes[k][:-1]

    for i in _by_priority(instance, released):
        best = best_insertion(instance, routes, i)
        if best:
            _place(routes, best, i)
    return _finish(instance, routes, current_report,
                   {'operation': 'handle_transport_changed', 'engineer_id': engineer_id})


# --- ручные действия диспетчера ------------------------------------------

def validate_move(instance: Instance, current_report: dict[str, Any], request_id: str,
                  to_engineer_id: str, position: int | None = None) -> dict[str, Any]:
    """Проверка ручного переноса заявки до того, как диспетчер его применит."""
    routes = _routes_from_report(instance, current_report)
    i = {t.id: n for n, t in enumerate(instance.tasks)}[request_id]
    src = next((k for k, r in enumerate(routes) if i in r), None)
    dst = _engineer_index(instance, to_engineer_id)

    trial = list(routes)
    if src is not None:
        trial[src] = tuple(x for x in trial[src] if x != i)
    ev = Evaluator(instance)
    pos = ev.insert(dst, trial[dst], i)[0] if position is None else position
    if pos is None or pos < 0:
        return {'feasible': False,
                'checks': {'skill': bool(ev.a.allowed[dst, i]), 'window': False},
                'violations': [{'code': 'NO_FEASIBLE_POSITION'}]}

    trial[dst] = trial[dst][:pos] + (i,) + trial[dst][pos:]
    violations = check_constraints(instance, trial)
    before = metrics(instance, routes)
    after = None if violations else metrics(instance, trial)
    return {
        'feasible': not violations,
        'violations': violations,
        'delta_km': None if after is None else after['km_total'] - before['km_total'],
        'delta_engineers': None if after is None else after['engineers_used'] - before['engineers_used'],
        'routes_raw': None if violations else trial,
    }


def suggest(instance: Instance, current_report: dict[str, Any], engineer_id: str,
            request_ids: list[str]) -> list[dict[str, Any]]:
    """Какие из заявок можно добавить инженеру прямо сейчас, лучшие — первыми."""
    routes = _routes_from_report(instance, current_report)
    k = _engineer_index(instance, engineer_id)
    idx = {t.id: i for i, t in enumerate(instance.tasks)}
    ev = Evaluator(instance)
    out = []
    for tid in request_ids:
        i = idx.get(tid)
        if i is None:
            continue
        pos, dist, _, _ = ev.insert(k, routes[k], i)
        if pos >= 0:
            out.append({'request_id': tid, 'engineer_id': engineer_id, 'position': pos,
                        'delta_km': (dist - ev.route(k, routes[k])[1]) / 1000,
                        'priority_rank': instance.tasks[i].priority_rank})
    return sorted(out, key=lambda x: (x['priority_rank'], x['delta_km'], x['request_id']))


def shift(instance: Instance, current_report: dict[str, Any], engineer_id: str,
          delay_minutes: int = 0, at_risk_slack_minutes: int = 15) -> dict[str, Any]:
    """Инженер задерживается: пересчитываем начало работ и помечаем опоздания и риски."""
    routes = _routes_from_report(instance, current_report)
    ev = Evaluator(instance)
    k = _engineer_index(instance, engineer_id)
    schedule = deepcopy(ev.schedule(k, routes[k]))
    any_flags = False
    for row in schedule:
        row['projected_start_minute'] = row['start_minute'] + delay_minutes
        row['projected_start'] = clock(row['projected_start_minute'])
        slack = row['window_slack_minutes'] - delay_minutes
        row['projected_slack_minutes'] = slack
        if slack < 0:
            row['flags'] = ['late']
        elif slack < at_risk_slack_minutes:
            row['flags'] = ['at_risk']
        else:
            row['flags'] = []
        any_flags |= bool(row['flags'])
    return {'engineer_id': engineer_id, 'schedule': schedule,
            'notify': bool(delay_minutes >= 15 or any_flags)}


def extend(instance: Instance, current_report: dict[str, Any], max_extra: int = 3):
    """Сколько покрытия дадут дополнительные универсальные инженеры на машине."""
    curve = [{'k': 0, 'coverage': current_report.get('coverage_pct', 0.0)}]
    if not instance.engineers:
        return curve
    universal_skills = tuple(sorted({t.skill for t in instance.tasks}))
    template = instance.engineers[0]
    transport = 'car' if 'car' in instance.travel_minutes else template.transport
    engineers = list(instance.engineers)
    for extra in range(1, max_extra + 1):
        engineers.append(Engineer(
            f'EXTRA_{extra}', template.start_node, template.shift_start, template.shift_end,
            universal_skills, transport,
            skill_levels=tuple((s, 3) for s in universal_skills), tools=template.tools,
            site_id=template.site_id, home_zone=template.home_zone))
        service = instance.service_by_engineer
        if service is not None:
            service = np.vstack([service, [t.duration for t in instance.tasks]])
        tmp = Instance(instance.tasks, list(engineers), instance.travel_minutes,
                       instance.distance_m, service, metadata=instance.metadata)
        res = plan(tmp, ProductionConfig(total_seconds=2.0, warm_iterations=250, master_seconds=.5))
        curve.append({'k': extra, 'coverage': res.report['coverage_pct'],
                      'engineers_used': res.report['active_engineers_today'],
                      'km': res.report['future_distance_km']})
        if res.report['unassigned_count'] == 0:
            break
    return curve

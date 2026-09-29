"""Оценка плана: допустимость маршрутов, целевой вектор, расписание и отчёт."""
from __future__ import annotations

from functools import lru_cache
from typing import Any

import numpy as np

from .kernels import evaluate, insertion_choices
from .model import Arrays, Instance, clock

Routes = list[tuple[int, ...]]


def _rank(task) -> int:
    return 1 if task.urgent else task.priority_rank


class Evaluator:
    """Считает всё, что касается конкретного плана.

    План — список маршрутов, по одному кортежу индексов заявок на инженера.
    Проверки маршрутов кешируются: поиск вызывает их миллионы раз.
    """

    def __init__(self, instance: Instance, buffer: float = 1.0):
        self.instance = instance
        self.a = Arrays.build(instance, buffer)
        a = self.a
        self.args = (a.travel, a.distance, a.service, a.nodes, a.opening, a.closing,
                     a.allowed, a.starts, a.shift_start, a.shift_end)
        self.route = lru_cache(maxsize=100_000)(self._route)
        self.insert = lru_cache(maxsize=100_000)(self.insert)

    # --- маршрут одного инженера ------------------------------------------

    def _route(self, k: int, route: tuple[int, ...]) -> tuple[bool, int, int, int]:
        """(допустим ли, метры, время окончания, минимальный запас)."""
        n = len(self.instance.tasks)
        bad_index = any(not isinstance(i, (int, np.integer)) or i < 0 or i >= n for i in route)
        has_duplicates = len(set(route)) != len(route)
        breaks_locked = tuple(route[:len(self.a.locked[k])]) != self.a.locked[k]
        if bad_index or has_duplicates or breaks_locked:
            return False, 0, 0, -1
        return evaluate(k, np.asarray(route, dtype=np.int64), *self.args)

    def insert(self, k: int, route: tuple[int, ...], i: int):
        """Лучшая вставка заявки i в маршрут k: (позиция или -1, метры, конец, запас)."""
        if i in route:
            return -1, 0, 0, -1
        return insertion_choices(k, np.asarray(route, dtype=np.int64), i,
                                 len(self.a.locked[k]), *self.args)

    # --- целевая функция --------------------------------------------------

    def soft_penalty(self, routes: Routes) -> int:
        """Лишние переезды между зонами (Москва ↔ город) внутри участка.

        Первая смена зоны бесплатна, каждая следующая — +1. Это последний,
        самый слабый критерий.
        """
        units = 0
        for r in routes:
            zones = [self.instance.tasks[i].zone for i in r if self.instance.tasks[i].zone]
            switches = sum(a != b for a, b in zip(zones, zones[1:]))
            units += max(0, switches - 1)
        return int(units)

    def key(self, routes: Routes) -> tuple[int, int, int, int, int, int]:
        """Целевой вектор, сравнивается лексикографически:

        (без исполнителя: аварии, подключения, остальное; инженеры; метры; мягкий штраф).
        Бросает ValueError, если план недопустим.
        """
        tasks = self.instance.tasks
        seen = [i for r in routes for i in r]
        if len(routes) != len(self.instance.engineers) or len(seen) != len(set(seen)):
            raise ValueError('A task was assigned more than once or engineer count mismatch')
        missing = set(range(len(tasks))) - set(seen)
        by_rank = [sum(_rank(tasks[i]) == rank for i in missing) for rank in (1, 2, 3)]
        active = sum(bool(r) or e.used_today for r, e in zip(routes, self.instance.engineers))
        distances = []
        for k, r in enumerate(routes):
            feasible, d, _, _ = self.route(k, r)
            if not feasible:
                raise ValueError(f'Infeasible route for {self.instance.engineers[k].id}')
            distances.append(d)
        return (int(by_rank[0]), int(by_rank[1]), int(by_rank[2]),
                active, int(sum(distances)), self.soft_penalty(routes))

    def energy(self, routes: Routes) -> float:
        """Целевой вектор, свёрнутый в одно число. Нужен эвристикам поиска."""
        u1, u2, u3, k, d, soft = self.key(routes)
        a = self.a
        return (u1 * a.rank1_weight + u2 * a.rank2_weight + u3 * a.rank3_weight
                + k * a.fleet_weight + d + soft)

    # --- расписание и объяснения ------------------------------------------

    def schedule(self, k: int, route: tuple[int, ...]) -> list[dict[str, Any]]:
        """Поминутное расписание маршрута: приезд, ожидание, начало, конец, запас."""
        if not self.route(k, route)[0]:
            raise ValueError('Cannot schedule an infeasible route')
        a = self.a
        now, prev = int(a.shift_start[k]), int(a.starts[k])
        records = []
        for i in route:
            t = self.instance.tasks[i]
            travel = int(a.travel[k, prev, t.node])
            arrival = now + travel
            start = max(arrival, int(a.opening[i]))
            end = start + int(a.service[k, i])
            records.append({
                'task_id': t.id,
                'arrival_minute': arrival, 'start_minute': start, 'end_minute': end,
                'arrival': clock(arrival), 'start': clock(start), 'end': clock(end),
                'waiting_minutes': start - arrival,
                'travel_minutes': travel,
                'leg_metres': int(a.distance[k, prev, t.node]),
                'window_slack_minutes': t.window_end - start,
            })
            now, prev = end, t.node
        return records

    def explain_unassigned(self, i: int, routes: Routes) -> dict:
        """Почему заявка осталась без исполнителя. Проверки идут от простых к сложным."""
        t = self.instance.tasks[i]
        engineers = self.instance.engineers

        with_skill = [k for k, e in enumerate(engineers) if t.skill in e.skills]
        if not with_skill:
            return {'code': 'NO_SKILL', 'text': 'Нет инженера с нужным навыком.',
                    'proven_static': True}

        with_level = [k for k in with_skill
                      if dict(engineers[k].skill_levels).get(t.skill, 1) >= t.min_skill_level]
        if not with_level:
            return {'code': 'NO_SKILL_LEVEL',
                    'text': 'Навык есть, но уровень квалификации ниже нужного.',
                    'proven_static': True}

        with_transport = [k for k in with_level
                          if engineers[k].available
                          and (t.transport is None or engineers[k].transport == t.transport)]
        if not with_transport:
            return {'code': 'NO_TRANSPORT',
                    'text': 'У инженеров с нужным навыком нет нужного транспорта.',
                    'proven_static': True}

        with_tools = [k for k in with_transport if set(t.required_tools).issubset(engineers[k].tools)]
        if not with_tools:
            return {'code': 'NO_EQUIPMENT',
                    'text': 'У подходящих инженеров нет нужного оборудования.',
                    'proven_static': True}

        compatible = [k for k in with_tools if self.a.allowed[k, i]]
        # Проверяем вставку сразу после замороженных визитов каждого инженера.
        # Это не доказательство, что заявку нельзя поставить вообще.
        possible = [k for k in compatible if self.insert(k, self.a.locked[k], i)[0] >= 0]
        if not possible:
            return {'code': 'NO_DIRECT_FEASIBLE_SLOT',
                    'text': 'Ни один подходящий инженер не успевает в окно или в смену '
                            'с учётом уже начатых работ.',
                    'proven_static': False}

        insertable = [engineers[k].id for k in possible if self.insert(k, routes[k], i)[0] >= 0]
        return {'code': 'NO_CAPACITY',
                'text': 'У подходящих инженеров нет свободного места в текущем плане.',
                'proven_static': False,
                'directly_insertable_into_current_plan': insertable}

    # --- итоговый отчёт ---------------------------------------------------

    def report(self, routes: Routes, meta: dict | None = None) -> dict:
        """Полный JSON-отчёт по плану: метрики, маршруты с расписанием, неназначенные."""
        tasks = self.instance.tasks
        key = self.key(routes)
        assigned = {i for r in routes for i in r}
        missing = set(range(len(tasks))) - assigned
        planned = len(tasks) - len(missing)
        out = {
            'objective': list(key),
            'unassigned_rank1': key[0], 'unassigned_rank2': key[1], 'unassigned_rank3': key[2],
            'unassigned_urgent': key[0],
            'unassigned_count': key[0] + key[1] + key[2],
            'active_engineers_today': key[3],
            'planned_count': planned,
            'coverage_pct': 0.0 if not tasks else 100.0 * planned / len(tasks),
            'future_distance_km': key[4] / 1000,
            'soft_penalty': key[5],
            'future_travel_minutes': 0,
            'urgent_response': {'planned_urgent': 0, 'mean_delay_from_earliest_min': 0.0,
                                'max_delay_from_earliest_min': 0},
            'routes': [],
            'unassigned': [],
            'metadata': dict(meta or {}),
            'data_metadata': self.instance.metadata,
        }

        urgent_delays = []
        for k, (r, e) in enumerate(zip(routes, self.instance.engineers)):
            schedule = self.schedule(k, r)
            travel_minutes = sum(int(row['travel_minutes']) for row in schedule)
            out['future_travel_minutes'] += travel_minutes
            for i, row in zip(r, schedule):
                if tasks[i].priority_rank == 1:
                    earliest = max(tasks[i].window_start, tasks[i].release_time)
                    urgent_delays.append(max(0, int(row['start_minute']) - int(earliest)))
            out['routes'].append({
                'engineer_id': e.id,
                'task_ids': [tasks[i].id for i in r],
                'distance_km': self.route(k, r)[1] / 1000,
                'travel_minutes': travel_minutes,
                'schedule': schedule,
                'explanation': (f'Проверены навык, транспорт, начало каждой работы в окне '
                                f'и конец всех работ до {clock(e.shift_end)}. '
                                f'Возвращаться на базу не нужно.'),
            })

        if urgent_delays:
            out['urgent_response'] = {
                'planned_urgent': len(urgent_delays),
                'mean_delay_from_earliest_min': float(sum(urgent_delays) / len(urgent_delays)),
                'max_delay_from_earliest_min': int(max(urgent_delays)),
            }

        for i in sorted(missing):
            out['unassigned'].append({'task_id': tasks[i].id,
                                      'priority_rank': tasks[i].priority_rank,
                                      **self.explain_unassigned(i, routes)})
        return out


def baseline(instance: Instance) -> Routes:
    """Базовый FIFO из условия кейса.

    Заявки в порядке поступления, первый инженер, к которому заявка помещается,
    вставка только в конец маршрута.
    """
    ev = Evaluator(instance)
    routes = list(ev.a.locked)
    already = {i for r in routes for i in r}
    for i in range(len(instance.tasks)):
        if i in already:
            continue
        for k, route in enumerate(routes):
            candidate = route + (i,)
            if ev.route(k, candidate)[0]:
                routes[k] = candidate
                break
    ev.key(routes)
    return routes

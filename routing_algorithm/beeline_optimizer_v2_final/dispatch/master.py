"""Сборка плана из пула маршрутов (MILP, решатель HiGHS).

Каждому инженеру выбирается не больше одного маршрута из уже найденных,
каждая заявка покрыта ровно один раз или остаётся без исполнителя.
Цели решаются по очереди: аварии → подключения → остальное → инженеры → метры.

Это не column generation: оптимальность здесь только в пределах пула,
если пул не перебран целиком.
"""
from __future__ import annotations
from time import perf_counter
import numpy as np
from scipy.optimize import milp, Bounds, LinearConstraint
from scipy.sparse import lil_matrix, csc_matrix, vstack
from .evaluate import Evaluator


def _stability_units(ev: Evaluator, owner: int, route: tuple[int, ...]) -> int:
    """Насколько маршрут меняет прошлый план: другой инженер — 4, другой порядок — 1.

    Считается только при перепланировании. В статическом плане всегда 0.
    """
    if not ev.instance.previous_assignment and not ev.instance.previous_predecessor:
        return 0
    engineer = ev.instance.engineers[owner].id
    predecessor = None
    units = 0
    for i in route:
        tid = ev.instance.tasks[i].id
        old_engineer = ev.instance.previous_assignment.get(tid)
        if old_engineer is not None and old_engineer != engineer:
            units += 4
        if tid in ev.instance.previous_predecessor and ev.instance.previous_predecessor[tid] != predecessor:
            units += 1
        predecessor = tid
    return units


def _route_soft_units(ev: Evaluator, route: tuple[int, ...]) -> int:
    zones = [ev.instance.tasks[i].zone for i in route if ev.instance.tasks[i].zone]
    switches = sum(a != b for a, b in zip(zones, zones[1:]))
    return max(0, switches - 1)


def build_master(ev: Evaluator, pool: list[set[tuple[int, ...]]]):
    """Строит матрицу MILP.

    Переменные: по одной на маршрут из пула и по одной «без исполнителя» на заявку.
    Строки: заявка покрыта ровно один раз; у инженера не больше одного маршрута.
    """
    n, k = len(ev.instance.tasks), len(ev.instance.engineers)
    columns = [(owner, r) for owner, routes in enumerate(pool)
               for r in sorted(routes) if r and ev.route(owner, r)[0]]
    p = len(columns)
    a = lil_matrix((n+k, p+n), dtype=float)
    for col, (owner, route) in enumerate(columns):
        a[n+owner, col] = 1
        for i in route:
            a[i, col] = 1
    for i in range(n):
        a[i, p+i] = 1
    lb = np.r_[np.ones(n), np.zeros(k)]
    ub = np.ones(n+k)
    for owner in range(k):
        if ev.a.locked[owner]:
            lb[n+owner] = 1
    upper = np.ones(p+n)
    for route in ev.a.locked:
        for i in route:
            upper[p+i] = 0
    objectives = []
    names = ['unassigned_rank1', 'unassigned_rank2', 'unassigned_rank3', 'new_active_engineers']
    if ev.instance.previous_assignment or ev.instance.previous_predecessor:
        names.append('stability_units')
    names += ['distance_m', 'soft_penalty']
    for name in names:
        c = np.zeros(p+n)
        if name.startswith('unassigned_rank'):
            rank = int(name[-1])
            c[p:] = (ev.a.priority_rank == rank).astype(float)
        elif name == 'new_active_engineers':
            c[:p] = [not ev.a.used[owner] for owner, _ in columns]
        elif name == 'stability_units':
            c[:p] = [_stability_units(ev, owner, r) for owner, r in columns]
        elif name == 'distance_m':
            c[:p] = [ev.route(owner, r)[1] for owner, r in columns]
        else:
            c[:p] = [_route_soft_units(ev, r) for owner, r in columns]
        objectives.append((name, c))
    return columns, csc_matrix(a), lb, ub, upper, objectives


def encode_solution(routes, columns, n):
    """План → вектор переменных MILP."""
    idx = {col: j for j, col in enumerate(columns)}
    x = np.zeros(len(columns)+n)
    x[len(columns):] = 1
    for owner, r in enumerate(routes):
        if r:
            x[idx[owner, r]] = 1
            for i in r:
                x[len(columns)+i] = 0
    return x


def decode_solution(x, columns, k):
    """Вектор переменных MILP → план."""
    routes = [() for _ in range(k)]
    for selected, (owner, route) in zip(x, columns):
        if selected > .5:
            if routes[owner]:
                raise ValueError('Master returned two routes for one engineer')
            routes[owner] = route
    return routes


def recombine(ev: Evaluator, pool, incumbent, seconds: float = 8.0, complete_pool: bool = False):
    """Лучшая комбинация маршрутов из пула. Никогда не хуже переданного плана."""
    t0 = perf_counter()
    for owner, route in enumerate(incumbent):
        if route:
            pool[owner].add(route)
    columns, a, lb, ub, upper, objectives = build_master(ev, pool)
    if a.shape[1] == 0:
        return incumbent, {'stages': [], 'columns': 0, 'global_optimal': True,
                           'seconds': perf_counter()-t0}
    incumbent_x = encode_solution(incumbent, columns, len(ev.instance.tasks))
    start_x = incumbent_x.copy()
    fixed_c, fixed_v, stages = [], [], []
    for j, (name, c) in enumerate(objectives):
        before = int(round(c @ incumbent_x))
        remaining = seconds - (perf_counter()-t0)
        # Все цели неотрицательны, поэтому ноль уже оптимален.
        if before == 0:
            status, value, bound, gap = 'OPTIMAL_ZERO_CERTIFICATE', 0, 0, 0.0
        elif remaining <= 0.01:
            status, value, bound, gap = 'BUDGET_EXHAUSTED', before, None, None
        else:
            mat = vstack([a] + [csc_matrix(row.reshape(1, -1)) for row in fixed_c] +
                         [csc_matrix(c.reshape(1, -1))], format='csc')
            lower = np.r_[lb, fixed_v, -np.inf]
            higher = np.r_[ub, fixed_v, before]
            result = milp(c, integrality=np.ones(len(c)), bounds=Bounds(np.zeros(len(c)), upper),
                          constraints=LinearConstraint(mat, lower, higher),
                          options={'time_limit': max(.02, remaining/(len(objectives)-j)), 'mip_rel_gap': 0.0})
            status = {0: 'OPTIMAL_IN_POOL', 1: 'TIME_LIMIT', 2: 'INFEASIBLE',
                      3: 'UNBOUNDED', 4: 'SOLVER_ERROR'}.get(result.status, 'UNKNOWN')
            value = before
            if result.x is not None:
                trial = np.rint(result.x)
                # Перепроверяем ответ решателя, прежде чем ему доверять.
                values = mat @ trial
                if (np.all(values >= lower-1e-6) and np.all(values <= higher+1e-6)
                        and np.all(trial >= 0) and np.all(trial <= upper)):
                    decoded = decode_solution(trial, columns, len(ev.instance.engineers))
                    ev.key(decoded)
                    value = int(round(c @ trial))
                    if value <= before:
                        incumbent_x = trial
            bound = getattr(result, 'mip_dual_bound', None)
            gap = getattr(result, 'mip_gap', None)
            bound = float(bound) if bound is not None and np.isfinite(bound) else None
            gap = float(gap) if gap is not None and np.isfinite(gap) else None
        fixed_c.append(c)
        fixed_v.append(value)
        stages.append({'objective': name, 'value': value, 'status': status,
                       'lower_bound_in_pool': bound, 'gap_in_pool': gap})
    routes = decode_solution(incumbent_x, columns, len(ev.instance.engineers))
    fallback_reason = None
    # Решатель с лимитом времени не должен ухудшить план. Под конец бюджета
    # числовые допуски иногда дают чуть худший ответ — тогда оставляем исходный.
    def objective_vector(x):
        return tuple(float(c @ x) for _, c in objectives)
    if objective_vector(incumbent_x) > objective_vector(start_x):
        routes = list(incumbent)
        fallback_reason = 'TIME_LIMIT_OR_NUMERICAL_DEGRADATION_FALLBACK_TO_INCUMBENT'
    return routes, {'stages': stages, 'columns': len(columns), 'seconds': perf_counter()-t0,
                    'complete_pool': complete_pool,
                    'global_optimal': bool(complete_pool and all(s['status'].startswith('OPTIMAL') for s in stages)),
                    'bound_scope': 'global for this supplied model' if complete_pool else 'restricted route pool only',
                    'fallback_reason': fallback_reason}


def enumerate_all_routes(ev: Evaluator, max_tasks: int = 8):
    """Все допустимые маршруты. Только для малых задач — для проверки на точном оптимуме."""
    n = len(ev.instance.tasks)
    if n > max_tasks:
        raise ValueError(f'Full enumeration is restricted to <= {max_tasks} tasks')
    pool = [set() for _ in ev.instance.engineers]
    for k in range(len(pool)):
        prefix = ev.a.locked[k]
        if not ev.route(k, prefix)[0]:
            raise ValueError('Infeasible locked prefix')
        def visit(route):
            if route:
                pool[k].add(route)
            for i in range(n):
                if i not in route and ev.a.allowed[k, i]:
                    nxt = route+(i,)
                    if ev.route(k, nxt)[0]:
                        visit(nxt)
        visit(prefix)
    return pool

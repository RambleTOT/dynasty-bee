"""Column generation для задачи маршрутизации (исследовательский режим).

Мастер-задача выбирает не больше одного маршрута на инженера и для каждой заявки —
покрыть её или явно оставить без исполнителя. Новые маршруты ищет pricing:
кратчайший путь с ресурсами и окнами (label setting).

Две разные «точности»:
- pricing сертифицирован, только если не упёрся в лимиты времени или меток;
- итоговое целочисленное решение оптимально только на сгенерированном пуле.
  Глобальный оптимум потребовал бы branch-and-price — его мы не заявляем.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from heapq import heappush, heappop
from time import perf_counter
from typing import Iterable
import math
import numpy as np
from scipy.optimize import linprog
from scipy.sparse import lil_matrix, csc_matrix

from .evaluate import Evaluator


@dataclass
class CGConfig:
    max_iterations: int = 80
    time_limit_seconds: float = 45.0
    pricing_time_per_engineer: float = 1.5
    max_columns_per_engineer: int = 8
    reduced_cost_epsilon: float = 1e-7
    # Fast pricing limits. These deliberately make pricing heuristic when hit.
    candidate_width: int | None = 24
    max_labels_per_node: int | None = 500
    max_total_labels: int | None = 80_000
    # When fast pricing finds no column, try a less restricted pass.
    certification_pass: bool = True
    certification_time_per_engineer: float = 2.0
    certification_max_total_labels: int | None = 250_000


@dataclass(frozen=True)
class Column:
    engineer: int
    route: tuple[int, ...]
    distance_m: int


@dataclass
class RMPResult:
    objective_scaled: float
    columns: list[Column]
    x: np.ndarray
    task_duals: np.ndarray
    engineer_duals: np.ndarray
    status: str
    message: str


@dataclass
class PricingResult:
    engineer: int
    routes: list[tuple[float, tuple[int, ...]]]
    completed: bool
    labels_generated: int
    labels_kept: int
    seconds: float
    reason: str


@dataclass
class CGResult:
    pool: list[set[tuple[int, ...]]]
    lp: RMPResult
    iterations: int
    columns_added: int
    pricing_certified: bool
    trace: list[dict] = field(default_factory=list)


def _route_cost_scaled(ev: Evaluator, k: int, route: tuple[int, ...]) -> float:
    """Weighted route cost divided by fleet_weight for better LP conditioning."""
    if not route:
        return 0.0
    dist = ev.route(k, route)[1]
    activation = 0.0 if ev.a.used[k] else 1.0
    return activation + dist / ev.a.fleet_weight


def _unassigned_cost_scaled(ev: Evaluator, i: int) -> float:
    return (ev.a.missing_weight + ev.a.urgent_weight * int(ev.a.urgent[i])) / ev.a.fleet_weight


def _valid_pool_columns(ev: Evaluator, pool: list[set[tuple[int, ...]]]) -> list[Column]:
    out: list[Column] = []
    for k, routes in enumerate(pool):
        for route in routes:
            route = tuple(route)
            if not route:
                continue
            ok, dist, _, _ = ev.route(k, route)
            if ok:
                out.append(Column(k, route, int(dist)))
    # Deterministic ordering makes dual/pricing tests reproducible.
    out.sort(key=lambda c: (c.engineer, len(c.route), c.route))
    return out


def solve_rmp(ev: Evaluator, pool: list[set[tuple[int, ...]]]) -> RMPResult:
    """Solve the LP restricted master and expose dual prices for pricing.

    Variables:
      x_kr in [0,1] for route columns
      u_i  in [0,1] for explicit unassignment

    Constraints:
      sum_{kr: i in r} x_kr + u_i = 1          for every task i
      sum_r x_kr <= 1                           for ordinary engineer k
      sum_r x_kr = 1                            if k has a locked prefix
    """
    n, K = len(ev.instance.tasks), len(ev.instance.engineers)
    cols = _valid_pool_columns(ev, pool)
    p = len(cols)
    nv = p + n

    c = np.zeros(nv, dtype=float)
    for j, col in enumerate(cols):
        c[j] = _route_cost_scaled(ev, col.engineer, col.route)
    for i in range(n):
        c[p+i] = _unassigned_cost_scaled(ev, i)

    # Task cover equalities.
    eq_rows = n + sum(bool(ev.a.locked[k]) for k in range(K))
    Aeq = lil_matrix((eq_rows, nv), dtype=float)
    beq = np.ones(eq_rows, dtype=float)
    for i in range(n):
        Aeq[i, p+i] = 1.0
    for j, col in enumerate(cols):
        for i in col.route:
            Aeq[i, j] = 1.0

    locked_eq_row: dict[int, int] = {}
    rr = n
    for k in range(K):
        if ev.a.locked[k]:
            locked_eq_row[k] = rr
            for j, col in enumerate(cols):
                if col.engineer == k:
                    Aeq[rr, j] = 1.0
            rr += 1

    unlocked = [k for k in range(K) if not ev.a.locked[k]]
    Aub = lil_matrix((len(unlocked), nv), dtype=float)
    bub = np.ones(len(unlocked), dtype=float)
    unlocked_row = {k: r for r, k in enumerate(unlocked)}
    for j, col in enumerate(cols):
        if col.engineer in unlocked_row:
            Aub[unlocked_row[col.engineer], j] = 1.0

    bounds = [(0.0, 1.0)] * nv
    # Locked tasks cannot be explicitly dropped.
    locked_tasks = {i for route in ev.a.locked for i in route}
    for i in locked_tasks:
        bounds[p+i] = (0.0, 0.0)

    res = linprog(
        c,
        A_ub=csc_matrix(Aub) if unlocked else None,
        b_ub=bub if unlocked else None,
        A_eq=csc_matrix(Aeq),
        b_eq=beq,
        bounds=bounds,
        method='highs',
    )
    if not res.success or res.x is None:
        raise RuntimeError(f'Restricted master LP failed: {res.status} {res.message}')

    task_duals = np.asarray(res.eqlin.marginals[:n], dtype=float)
    engineer_duals = np.zeros(K, dtype=float)
    for k, row in locked_eq_row.items():
        engineer_duals[k] = float(res.eqlin.marginals[row])
    if unlocked:
        marg = np.asarray(res.ineqlin.marginals, dtype=float)
        for k, row in unlocked_row.items():
            engineer_duals[k] = float(marg[row])

    return RMPResult(
        objective_scaled=float(res.fun),
        columns=cols,
        x=np.asarray(res.x[:p], dtype=float),
        task_duals=task_duals,
        engineer_duals=engineer_duals,
        status='OPTIMAL',
        message=str(res.message),
    )


@dataclass(slots=True)
class _Label:
    last_task: int
    time: int
    distance_m: int
    base_reduced_cost: float
    mask: int
    route: tuple[int, ...]


def _mask_subset(a: int, b: int) -> bool:
    """Whether visited set a is a subset of b."""
    return (a & b) == a


def _dominates(a: _Label, b: _Label, eps: float = 1e-10) -> bool:
    # Same current task/node is guaranteed by the bucket in which this is called.
    return (a.time <= b.time and
            a.base_reduced_cost <= b.base_reduced_cost + eps and
            _mask_subset(a.mask, b.mask))


def _prefix_state(ev: Evaluator, k: int, task_duals: np.ndarray,
                  activation_coeff: float = 1.0, distance_coeff: float | None = None):
    if distance_coeff is None:
        distance_coeff = 1.0 / ev.a.fleet_weight
    route = tuple(ev.a.locked[k])
    now = int(ev.a.shift_start[k])
    prev_node = int(ev.a.starts[k])
    dist = 0
    mask = 0
    reward = 0.0
    for i in route:
        node = int(ev.a.nodes[i])
        now += int(ev.a.travel[k, prev_node, node])
        now = max(now, int(ev.a.opening[i]))
        if now > int(ev.a.closing[i]):
            raise ValueError('Infeasible locked prefix')
        now += int(ev.a.service[k, i])
        if now > int(ev.a.shift_end[k]):
            raise ValueError('Infeasible locked prefix')
        dist += int(ev.a.distance[k, prev_node, node])
        reward += float(task_duals[i])
        mask |= 1 << int(i)
        prev_node = node
    activation = 0.0 if ev.a.used[k] else (1.0 if route else 0.0)
    base = activation_coeff * activation + distance_coeff * dist - reward
    return route, now, prev_node, dist, mask, base


def _candidate_extensions(ev: Evaluator, k: int, label: _Label, task_duals: np.ndarray,
                          candidate_width: int | None, distance_coeff: float | None = None) -> list[int]:
    if distance_coeff is None:
        distance_coeff = 1.0 / ev.a.fleet_weight
    n = len(ev.instance.tasks)
    prev_node = int(ev.a.starts[k]) if label.last_task < 0 else int(ev.a.nodes[label.last_task])
    cand = []
    for j in range(n):
        if label.mask & (1 << j) or not ev.a.allowed[k, j]:
            continue
        node = int(ev.a.nodes[j])
        arrival = label.time + int(ev.a.travel[k, prev_node, node])
        start = max(arrival, int(ev.a.opening[j]))
        finish = start + int(ev.a.service[k, j])
        if start > int(ev.a.closing[j]) or finish > int(ev.a.shift_end[k]):
            continue
        inc = distance_coeff * int(ev.a.distance[k, prev_node, node]) - float(task_duals[j])
        # Earlier close is a tie breaker, not an extra objective.
        cand.append((inc, int(ev.a.closing[j]), j))
    cand.sort()
    if candidate_width is not None:
        cand = cand[:candidate_width]
    return [j for _, _, j in cand]


def price_engineer(ev: Evaluator, k: int, task_duals: np.ndarray, engineer_dual: float,
                   *, seconds: float, max_columns: int = 8, epsilon: float = 1e-7,
                   candidate_width: int | None = 24,
                   max_labels_per_node: int | None = 500,
                   max_total_labels: int | None = 80_000,
                   activation_coeff: float = 1.0,
                   distance_coeff: float | None = None) -> PricingResult:
    """Generate negative reduced-cost routes for one engineer.

    This is an elementary label-setting RCSP. If any time/label/candidate cap is
    active and becomes binding, `completed=False`; therefore absence of a column
    is not advertised as an optimality certificate.
    """
    t0 = perf_counter()
    deadline = t0 + max(0.001, seconds)
    n = len(ev.instance.tasks)
    if distance_coeff is None:
        distance_coeff = 1.0 / ev.a.fleet_weight
    prefix, now, prev_node, dist, mask, base = _prefix_state(
        ev, k, task_duals, activation_coeff=activation_coeff, distance_coeff=distance_coeff)

    # Initial label is bucketed under -1 when no prefix, otherwise by final task.
    last = prefix[-1] if prefix else -1
    initial = _Label(last, now, dist, base, mask, prefix)
    heap: list[tuple[float, int, int, _Label]] = []
    serial = 0
    heappush(heap, (initial.base_reduced_cost, initial.time, serial, initial))
    buckets: dict[int, list[_Label]] = {last: [initial]}
    generated = 1
    kept = 1
    completed = True
    reason = 'EXHAUSTED_LABELS'
    best_routes: dict[tuple[int, ...], float] = {}

    def consider_route(label: _Label):
        if not label.route:
            return
        # If prefix is empty, activation cost is charged at first visited task.
        base_rc = label.base_reduced_cost
        if not prefix and label.route:
            # Labels created from an empty prefix add activation on first extension.
            pass
        rc = base_rc - engineer_dual
        if rc < -epsilon:
            old = best_routes.get(label.route)
            if old is None or rc < old:
                best_routes[label.route] = float(rc)

    consider_route(initial)
    while heap:
        if perf_counter() >= deadline:
            completed = False
            reason = 'TIME_LIMIT'
            break
        _, _, _, lab = heappop(heap)
        # It may have been removed as dominated after entering the heap.
        if lab not in buckets.get(lab.last_task, []):
            continue
        for j in _candidate_extensions(ev, k, lab, task_duals, candidate_width, distance_coeff=distance_coeff):
            prev = int(ev.a.starts[k]) if lab.last_task < 0 else int(ev.a.nodes[lab.last_task])
            node = int(ev.a.nodes[j])
            arrival = lab.time + int(ev.a.travel[k, prev, node])
            start = max(arrival, int(ev.a.opening[j]))
            finish = start + int(ev.a.service[k, j])
            # Feasibility is intentionally repeated here: candidate generation is an optimization only.
            if start > int(ev.a.closing[j]) or finish > int(ev.a.shift_end[k]):
                continue
            ndist = lab.distance_m + int(ev.a.distance[k, prev, node])
            nbase = lab.base_reduced_cost + distance_coeff * int(ev.a.distance[k, prev, node]) - float(task_duals[j])
            if not lab.route and not prefix and not ev.a.used[k]:
                nbase += activation_coeff  # activating a new engineer
            nr = lab.route + (j,)
            nl = _Label(j, finish, ndist, nbase, lab.mask | (1 << j), nr)
            generated += 1

            bucket = buckets.setdefault(j, [])
            dominated = False
            for old in bucket:
                if _dominates(old, nl):
                    dominated = True
                    break
            if dominated:
                continue
            bucket[:] = [old for old in bucket if not _dominates(nl, old)]
            bucket.append(nl)
            if max_labels_per_node is not None and len(bucket) > max_labels_per_node:
                # Keep the most promising labels. Hitting this makes pricing heuristic.
                bucket.sort(key=lambda x: (x.base_reduced_cost, x.time, x.mask.bit_count()))
                del bucket[max_labels_per_node:]
                completed = False
                reason = 'LABEL_CAP'
                if nl not in bucket:
                    continue
            serial += 1
            heappush(heap, (nl.base_reduced_cost, nl.time, serial, nl))
            kept += 1
            consider_route(nl)
            if max_total_labels is not None and kept >= max_total_labels:
                completed = False
                reason = 'TOTAL_LABEL_CAP'
                heap.clear()
                break
        if max_total_labels is not None and kept >= max_total_labels:
            break

    items = sorted((rc, r) for r, rc in best_routes.items())[:max_columns]
    # Candidate-width restriction is heuristic even if no explicit cap was hit.
    if candidate_width is not None and candidate_width < n:
        completed = False
        if reason == 'EXHAUSTED_LABELS':
            reason = 'CANDIDATE_RESTRICTION'
    return PricingResult(k, items, completed, generated, kept, perf_counter()-t0, reason)


def seed_pool(ev: Evaluator, pool: list[set[tuple[int, ...]]], incumbent: Iterable[tuple[int, ...]] | None = None) -> None:
    """Add mandatory prefixes, incumbent routes and every feasible one-task extension."""
    if incumbent is not None:
        for k, r in enumerate(incumbent):
            if r and ev.route(k, tuple(r))[0]:
                pool[k].add(tuple(r))
    n = len(ev.instance.tasks)
    for k in range(len(ev.instance.engineers)):
        prefix = tuple(ev.a.locked[k])
        if prefix:
            pool[k].add(prefix)
        for i in range(n):
            if i in prefix or not ev.a.allowed[k, i]:
                continue
            route = prefix + (i,)
            if ev.route(k, route)[0]:
                pool[k].add(route)


def column_generate(ev: Evaluator, pool: list[set[tuple[int, ...]]], config: CGConfig | None = None,
                    incumbent: Iterable[tuple[int, ...]] | None = None) -> CGResult:
    cfg = config or CGConfig()
    if len(pool) != len(ev.instance.engineers):
        raise ValueError('Pool must have one route set per engineer')
    seed_pool(ev, pool, incumbent)
    t0 = perf_counter()
    deadline = t0 + cfg.time_limit_seconds
    trace: list[dict] = []
    added_total = 0
    last_lp: RMPResult | None = None
    pricing_certified = False

    for it in range(cfg.max_iterations):
        if perf_counter() >= deadline:
            break
        lp = solve_rmp(ev, pool)
        last_lp = lp
        trace.append({'iteration': it, 'seconds': perf_counter()-t0,
                      'lp_objective_scaled': lp.objective_scaled,
                      'columns': sum(len(s) for s in pool)})

        added = 0
        fast_results: list[PricingResult] = []
        for k in range(len(ev.instance.engineers)):
            remaining = deadline - perf_counter()
            if remaining <= .01:
                break
            pr = price_engineer(
                ev, k, lp.task_duals, lp.engineer_duals[k],
                seconds=min(cfg.pricing_time_per_engineer, remaining),
                max_columns=cfg.max_columns_per_engineer,
                epsilon=cfg.reduced_cost_epsilon,
                candidate_width=cfg.candidate_width,
                max_labels_per_node=cfg.max_labels_per_node,
                max_total_labels=cfg.max_total_labels,
            )
            fast_results.append(pr)
            for rc, route in pr.routes:
                if route not in pool[k]:
                    pool[k].add(route)
                    added += 1

        # If the fast pass itself was unrestricted and completed for every engineer,
        # it already certifies the pricing condition when no negative column exists.
        if (added == 0 and cfg.candidate_width is None and
                len(fast_results) == len(ev.instance.engineers) and
                all(p.completed for p in fast_results)):
            pricing_certified = True

        # Otherwise, if fast pricing found nothing, make a broader pass. Only a fully completed
        # unrestricted pass for every engineer can certify the LP pricing condition.
        cert_results: list[PricingResult] = []
        if added == 0 and not pricing_certified and cfg.certification_pass and perf_counter() < deadline:
            all_complete = True
            for k in range(len(ev.instance.engineers)):
                remaining = deadline - perf_counter()
                if remaining <= .01:
                    all_complete = False
                    break
                pr = price_engineer(
                    ev, k, lp.task_duals, lp.engineer_duals[k],
                    seconds=min(cfg.certification_time_per_engineer, remaining),
                    max_columns=cfg.max_columns_per_engineer,
                    epsilon=cfg.reduced_cost_epsilon,
                    candidate_width=None,
                    max_labels_per_node=None,
                    max_total_labels=cfg.certification_max_total_labels,
                )
                cert_results.append(pr)
                all_complete = all_complete and pr.completed
                for rc, route in pr.routes:
                    if route not in pool[k]:
                        pool[k].add(route)
                        added += 1
            if added == 0 and all_complete and len(cert_results) == len(ev.instance.engineers):
                pricing_certified = True

        added_total += added
        trace[-1]['added'] = added
        trace[-1]['fast_pricing'] = [
            {'engineer': p.engineer, 'negative_columns': len(p.routes), 'completed': p.completed,
             'labels': p.labels_kept, 'reason': p.reason, 'seconds': p.seconds}
            for p in fast_results]
        if cert_results:
            trace[-1]['certification_pricing'] = [
                {'engineer': p.engineer, 'negative_columns': len(p.routes), 'completed': p.completed,
                 'labels': p.labels_kept, 'reason': p.reason, 'seconds': p.seconds}
                for p in cert_results]
        if added == 0:
            break

    if last_lp is None or added_total > 0:
        # Re-solve once so reported duals/objective correspond to the final pool.
        last_lp = solve_rmp(ev, pool)
    return CGResult(pool, last_lp, len(trace), added_total, pricing_certified, trace)


def reduced_cost_of_route(ev: Evaluator, k: int, route: tuple[int, ...], lp: RMPResult) -> float:
    """Utility for tests/debugging: reduced cost of an arbitrary feasible route."""
    if not ev.route(k, route)[0]:
        raise ValueError('Route is infeasible')
    return (_route_cost_scaled(ev, k, route)
            - sum(float(lp.task_duals[i]) for i in route)
            - float(lp.engineer_duals[k]))

"""Лексикографический column generation (исследовательский режим).

В отличие от взвешенной суммы, цели решаются по очереди:
  1) аварии без исполнителя,
  2) все заявки без исполнителя,
  3) новые задействованные инженеры,
  4) пробег.
Значение каждой цели фиксируется, затем оптимизируется следующая.
Новые маршруты добавляются pricing по приведённой стоимости.

Этап сертифицирован для LP-релаксации, только если pricing прошёл полностью
для каждого инженера.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from time import perf_counter
from typing import Iterable
import numpy as np
from scipy.optimize import linprog
from scipy.sparse import lil_matrix, csc_matrix

from .evaluate import Evaluator
from .column_generation import Column, PricingResult, price_engineer, seed_pool, _valid_pool_columns

STAGES = ('unassigned_urgent', 'unassigned_total', 'new_active_engineers', 'distance_km')


@dataclass
class LexCGConfig:
    max_iterations_per_stage: int = 30
    time_limit_seconds: float = 35.0
    pricing_time_per_engineer: float = 0.25
    max_columns_per_engineer: int = 8
    reduced_cost_epsilon: float = 1e-7
    candidate_width: int | None = 24
    max_labels_per_node: int | None = 500
    max_total_labels: int | None = 80_000
    certification_pass: bool = True
    certification_time_per_engineer: float = 0.7
    certification_max_total_labels: int | None = 250_000
    # Reserve meaningful time for later stages rather than letting coverage consume all time.
    stage_time_shares: tuple[float, float, float, float] = (.15, .25, .25, .35)


@dataclass
class LexRMPResult:
    stage: str
    objective_value: float
    columns: list[Column]
    x: np.ndarray
    u: np.ndarray
    task_duals: np.ndarray
    engineer_duals: np.ndarray
    fixed_duals: dict[str, float]
    activation_coeff_for_pricing: float
    distance_coeff_for_pricing: float
    status: str
    message: str


@dataclass
class LexStageResult:
    stage: str
    objective_value: float
    iterations: int
    columns_added: int
    pricing_certified: bool
    seconds: float
    trace: list[dict] = field(default_factory=list)


@dataclass
class LexCGResult:
    pool: list[set[tuple[int, ...]]]
    stages: list[LexStageResult]
    final_lp: LexRMPResult
    columns_added: int
    all_stages_certified: bool
    seconds: float


def _objective_coefficients(ev: Evaluator, cols: list[Column], stage: str):
    p, n = len(cols), len(ev.instance.tasks)
    c = np.zeros(p+n, dtype=float)
    if stage == 'unassigned_urgent':
        c[p:] = ev.a.urgent.astype(float)
    elif stage == 'unassigned_total':
        c[p:] = 1.0
    elif stage == 'new_active_engineers':
        c[:p] = [0.0 if ev.a.used[col.engineer] else 1.0 for col in cols]
    elif stage == 'distance_km':
        c[:p] = [float(col.distance_m) / 1000.0 for col in cols]
    else:
        raise ValueError(f'Unknown lexicographic stage: {stage}')
    return c


def _route_coeff_basis(stage: str) -> tuple[float, float]:
    """Route objective coefficient represented as alpha*activation + beta*distance_m."""
    if stage in ('unassigned_urgent', 'unassigned_total'):
        return 0.0, 0.0
    if stage == 'new_active_engineers':
        return 1.0, 0.0
    if stage == 'distance_km':
        return 0.0, 1.0 / 1000.0
    raise ValueError(stage)


def solve_lex_rmp(ev: Evaluator, pool: list[set[tuple[int, ...]]], stage: str,
                  fixed_values: dict[str, float] | None = None) -> LexRMPResult:
    """Solve one stage of the sequential LP restricted master and expose duals."""
    fixed_values = dict(fixed_values or {})
    n, K = len(ev.instance.tasks), len(ev.instance.engineers)
    cols = _valid_pool_columns(ev, pool)
    p = len(cols)
    nv = p+n
    c = _objective_coefficients(ev, cols, stage)

    locked_engineers = [k for k in range(K) if ev.a.locked[k]]
    # task cover + locked engineer equalities + previous objective equalities
    eq_rows = n + len(locked_engineers) + len(fixed_values)
    Aeq = lil_matrix((eq_rows, nv), dtype=float)
    beq = np.zeros(eq_rows, dtype=float)
    beq[:n] = 1.0
    for i in range(n):
        Aeq[i, p+i] = 1.0
    for j, col in enumerate(cols):
        for i in col.route:
            Aeq[i, j] = 1.0

    locked_eq_row: dict[int, int] = {}
    rr = n
    for k in locked_engineers:
        locked_eq_row[k] = rr
        beq[rr] = 1.0
        for j, col in enumerate(cols):
            if col.engineer == k:
                Aeq[rr, j] = 1.0
        rr += 1

    fixed_eq_row: dict[str, int] = {}
    for prev_stage, value in fixed_values.items():
        fixed_eq_row[prev_stage] = rr
        Aeq[rr, :] = _objective_coefficients(ev, cols, prev_stage)
        beq[rr] = float(value)
        rr += 1

    unlocked = [k for k in range(K) if k not in locked_eq_row]
    Aub = lil_matrix((len(unlocked), nv), dtype=float)
    bub = np.ones(len(unlocked), dtype=float)
    unlocked_row = {k: r for r, k in enumerate(unlocked)}
    for j, col in enumerate(cols):
        r = unlocked_row.get(col.engineer)
        if r is not None:
            Aub[r, j] = 1.0

    bounds = [(0.0, 1.0)] * nv
    locked_tasks = {i for route in ev.a.locked for i in route}
    for i in locked_tasks:
        bounds[p+i] = (0.0, 0.0)

    res = linprog(
        c,
        A_ub=csc_matrix(Aub) if unlocked else None,
        b_ub=bub if unlocked else None,
        A_eq=csc_matrix(Aeq), b_eq=beq,
        bounds=bounds, method='highs',
    )
    if not res.success or res.x is None:
        raise RuntimeError(f'Lexicographic restricted master failed at {stage}: {res.status} {res.message}')

    task_duals = np.asarray(res.eqlin.marginals[:n], dtype=float)
    engineer_duals = np.zeros(K, dtype=float)
    for k, row in locked_eq_row.items():
        engineer_duals[k] = float(res.eqlin.marginals[row])
    if unlocked:
        marg = np.asarray(res.ineqlin.marginals, dtype=float)
        for k, row in unlocked_row.items():
            engineer_duals[k] = float(marg[row])
    fixed_duals = {name: float(res.eqlin.marginals[row]) for name, row in fixed_eq_row.items()}

    cur_a, cur_d = _route_coeff_basis(stage)
    pricing_a, pricing_d = cur_a, cur_d
    for prev, dual in fixed_duals.items():
        a, d = _route_coeff_basis(prev)
        pricing_a -= dual * a
        pricing_d -= dual * d

    return LexRMPResult(
        stage=stage,
        objective_value=float(res.fun),
        columns=cols,
        x=np.asarray(res.x[:p], dtype=float),
        u=np.asarray(res.x[p:], dtype=float),
        task_duals=task_duals,
        engineer_duals=engineer_duals,
        fixed_duals=fixed_duals,
        activation_coeff_for_pricing=float(pricing_a),
        distance_coeff_for_pricing=float(pricing_d),
        status='OPTIMAL', message=str(res.message),
    )


def reduced_cost_lex(ev: Evaluator, k: int, route: tuple[int, ...], lp: LexRMPResult) -> float:
    if not ev.route(k, route)[0]:
        raise ValueError('Route is infeasible')
    activation = 0.0 if ev.a.used[k] else 1.0
    dist = ev.route(k, route)[1]
    return (lp.activation_coeff_for_pricing * activation
            + lp.distance_coeff_for_pricing * dist
            - sum(float(lp.task_duals[i]) for i in route)
            - float(lp.engineer_duals[k]))


def _price_all(ev: Evaluator, lp: LexRMPResult, pool, cfg: LexCGConfig,
               deadline: float, *, certification: bool = False):
    results: list[PricingResult] = []
    added = 0
    for k in range(len(ev.instance.engineers)):
        remaining = deadline-perf_counter()
        if remaining <= .005:
            break
        if certification:
            seconds = min(cfg.certification_time_per_engineer, remaining)
            width = None
            per_node = None
            total = cfg.certification_max_total_labels
        else:
            seconds = min(cfg.pricing_time_per_engineer, remaining)
            width = cfg.candidate_width
            per_node = cfg.max_labels_per_node
            total = cfg.max_total_labels
        pr = price_engineer(
            ev, k, lp.task_duals, lp.engineer_duals[k],
            seconds=seconds, max_columns=cfg.max_columns_per_engineer,
            epsilon=cfg.reduced_cost_epsilon,
            candidate_width=width, max_labels_per_node=per_node,
            max_total_labels=total,
            activation_coeff=lp.activation_coeff_for_pricing,
            distance_coeff=lp.distance_coeff_for_pricing,
        )
        results.append(pr)
        for rc, route in pr.routes:
            if route not in pool[k]:
                pool[k].add(route)
                added += 1
    return added, results


def column_generate_lexicographic(ev: Evaluator, pool: list[set[tuple[int, ...]]],
                                  config: LexCGConfig | None = None,
                                  incumbent: Iterable[tuple[int, ...]] | None = None) -> LexCGResult:
    cfg = config or LexCGConfig()
    if len(pool) != len(ev.instance.engineers):
        raise ValueError('Pool must have one route set per engineer')
    if len(cfg.stage_time_shares) != len(STAGES) or sum(cfg.stage_time_shares) <= 0:
        raise ValueError('stage_time_shares must contain four positive-budget shares')
    seed_pool(ev, pool, incumbent)
    t0 = perf_counter()
    global_deadline = t0 + cfg.time_limit_seconds
    shares = np.asarray(cfg.stage_time_shares, dtype=float)
    shares = shares / shares.sum()
    fixed_values: dict[str, float] = {}
    stage_results: list[LexStageResult] = []
    total_added = 0
    final_lp: LexRMPResult | None = None

    cumulative_share = 0.0
    for stage_idx, stage in enumerate(STAGES):
        stage_t0 = perf_counter()
        cumulative_share += float(shares[stage_idx])
        stage_deadline = min(global_deadline, t0 + cfg.time_limit_seconds*cumulative_share)
        trace: list[dict] = []
        added_stage = 0
        certified = False
        last_lp = solve_lex_rmp(ev, pool, stage, fixed_values)

        for it in range(cfg.max_iterations_per_stage):
            if perf_counter() >= stage_deadline:
                break
            lp = solve_lex_rmp(ev, pool, stage, fixed_values)
            last_lp = lp
            added, fast = _price_all(ev, lp, pool, cfg, stage_deadline, certification=False)
            cert: list[PricingResult] = []
            if added == 0:
                if (cfg.candidate_width is None and len(fast) == len(ev.instance.engineers)
                        and all(x.completed for x in fast)):
                    certified = True
                elif cfg.certification_pass and perf_counter() < stage_deadline:
                    added, cert = _price_all(ev, lp, pool, cfg, stage_deadline, certification=True)
                    if (added == 0 and len(cert) == len(ev.instance.engineers)
                            and all(x.completed for x in cert)):
                        certified = True
            added_stage += added
            total_added += added
            trace.append({
                'iteration': it,
                'objective': lp.objective_value,
                'columns': sum(len(x) for x in pool),
                'added': added,
                'pricing_activation_coeff': lp.activation_coeff_for_pricing,
                'pricing_distance_coeff': lp.distance_coeff_for_pricing,
                'fast': [{'engineer': x.engineer, 'negative_columns': len(x.routes),
                          'completed': x.completed, 'labels': x.labels_kept,
                          'reason': x.reason, 'seconds': x.seconds} for x in fast],
                'certification': [{'engineer': x.engineer, 'negative_columns': len(x.routes),
                                   'completed': x.completed, 'labels': x.labels_kept,
                                   'reason': x.reason, 'seconds': x.seconds} for x in cert],
            })
            if added == 0:
                break

        # Always re-solve on the final pool for the value that is frozen.
        last_lp = solve_lex_rmp(ev, pool, stage, fixed_values)
        final_lp = last_lp
        fixed_values[stage] = last_lp.objective_value
        stage_results.append(LexStageResult(
            stage=stage, objective_value=last_lp.objective_value,
            iterations=len(trace), columns_added=added_stage,
            pricing_certified=certified, seconds=perf_counter()-stage_t0, trace=trace))
        if perf_counter() >= global_deadline:
            # Later objectives receive zero extra search budget but are still solved on current pool
            # so final metadata remains complete and interpretable.
            for rest in STAGES[stage_idx+1:]:
                lp_rest = solve_lex_rmp(ev, pool, rest, fixed_values)
                final_lp = lp_rest
                fixed_values[rest] = lp_rest.objective_value
                stage_results.append(LexStageResult(rest, lp_rest.objective_value, 0, 0, False, 0.0, []))
            break

    assert final_lp is not None
    return LexCGResult(
        pool=pool, stages=stage_results, final_lp=final_lp,
        columns_added=total_added,
        all_stages_certified=all(s.pricing_certified for s in stage_results),
        seconds=perf_counter()-t0,
    )

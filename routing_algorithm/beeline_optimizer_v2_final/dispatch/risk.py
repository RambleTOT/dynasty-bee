"""Оценка плана на сценариях и выбор маршрутов с учётом риска.

Встроенный генератор сценариев — тестовая модель, а не обученная модель пробок
или инженеров. Для реальной работы нужны сценарии, откалиброванные на своих данных,
и проверка плана на отдельных днях.
"""
from __future__ import annotations
from dataclasses import dataclass
from time import perf_counter
import math
import numpy as np
from numba import njit
from scipy.optimize import milp, Bounds, LinearConstraint
from scipy.sparse import csc_matrix, hstack, vstack, eye, lil_matrix
from .model import Instance
from .evaluate import Evaluator
from .master import build_master, decode_solution


@dataclass
class Scenarios:
    travel: np.ndarray  # S x K x V x V, minutes
    service: np.ndarray  # S x K x N, minutes
    origin: str
    seed: int | None = None

    def validate(self, ev: Evaluator):
        if self.travel.ndim != 4 or self.travel.shape[1:] != ev.a.travel.shape:
            raise ValueError('Scenario travel must be S x K x V x V')
        s = self.travel.shape[0]
        if s < 2 or self.service.shape != (s, *ev.a.service.shape):
            raise ValueError('Scenario service must be S x K x N with the same S >= 2')
        if np.any(~np.isfinite(self.travel)) or np.any(self.travel < 0):
            raise ValueError('Invalid scenario travel')
        if np.any(~np.isfinite(self.service)) or np.any(self.service < 0):
            raise ValueError('Invalid scenario service')
        if not self.origin:
            raise ValueError('Scenario provenance is mandatory')


def synthetic_scenarios(instance: Instance, count=128, seed=123,
                        day_sigma=.12, edge_sigma=.10, service_sigma=.20) -> Scenarios:
    if count < 2 or min(day_sigma, edge_sigma, service_sigma) < 0:
        raise ValueError('Invalid synthetic scenario parameters')
    ev = Evaluator(instance)
    rng = np.random.default_rng(seed)
    k, v, _ = ev.a.travel.shape
    n = len(instance.tasks)
    # Correlated day-level disturbance across all engineers and edges.
    day = np.exp(rng.normal(-day_sigma**2/2, day_sigma, (count, 1, 1, 1))).astype(np.float32)
    edge = np.exp(rng.normal(-edge_sigma**2/2, edge_sigma, (count, k, v, v))).astype(np.float32)
    travel = ev.a.travel.astype(np.float32)[None]*day*edge
    service_day = np.exp(rng.normal(-.08**2/2, .08, (count, 1, 1))).astype(np.float32)
    service_noise = np.exp(rng.normal(-service_sigma**2/2, service_sigma,
                                      (count, k, n))).astype(np.float32)
    service = ev.a.service.astype(np.float32)[None]*service_day*service_noise
    return Scenarios(travel, service,
                     'SYNTHETIC_LOGNORMAL_TEST_MODEL_NOT_CALIBRATED_TO_BEELINE', seed)


@njit(cache=True)
def route_outcomes(k, route, travel, service, nodes, opening, closing,
                   starts, shift_start, shift_end, urgent, urgent_weight, overtime_weight):
    s_count = travel.shape[0]
    loss = np.zeros(s_count)
    late = np.zeros((s_count, len(route)), dtype=np.bool_)
    overtime = np.zeros(s_count)
    for s in range(s_count):
        now = float(shift_start[k])
        prev = starts[k]
        for pos, i in enumerate(route):
            node = nodes[i]
            now += travel[s, k, prev, node]
            now = max(now, float(opening[i]))
            tardiness = max(0.0, now-closing[i])
            late[s, pos] = tardiness > 1e-7
            loss[s] += tardiness*(urgent_weight if urgent[i] else 1.0)
            now += service[s, k, i]
            prev = node
        overtime[s] = max(0.0, now-shift_end[k])
        loss[s] += overtime[s]*overtime_weight
    return loss, late, overtime


def outcomes(ev, scenarios, k, route, urgent_weight=3.0, overtime_weight=1.0):
    a = ev.a
    return route_outcomes(k, np.asarray(route, dtype=np.int64), scenarios.travel, scenarios.service,
                          a.nodes, a.opening, a.closing, a.starts, a.shift_start, a.shift_end,
                          a.urgent, urgent_weight, overtime_weight)


def cvar(values, alpha=.95) -> float:
    if not 0 <= alpha < 1:
        raise ValueError('alpha must be in [0, 1)')
    x = np.asarray(values, dtype=float)
    # Convex minimizer for the empirical Rockafellar-Uryasev formulation.
    eta = float(np.sort(x)[max(0, min(len(x)-1, math.ceil(alpha*len(x))-1))])
    return eta + float(np.maximum(x-eta, 0).mean())/(1-alpha)


def wilson(successes: int, n: int):
    p = successes/n
    z = 1.959963984540054
    center = (p+z*z/(2*n))/(1+z*z/n)
    radius = z*math.sqrt(p*(1-p)/n+z*z/(4*n*n))/(1+z*z/n)
    return [max(0., center-radius), min(1., center+radius)]


def evaluate_risk(instance: Instance, routes, scenarios: Scenarios, alpha=.95,
                  urgent_weight=3.0, overtime_weight=1.0):
    ev = Evaluator(instance)
    ev.key(routes)
    scenarios.validate(ev)
    s_count = scenarios.travel.shape[0]
    total = np.zeros(s_count)
    any_late = np.zeros(s_count, dtype=bool)
    late_count = np.zeros(s_count)
    overtime_total = np.zeros(s_count)
    jobs = []
    for k, route in enumerate(routes):
        losses, late, overtime = outcomes(ev, scenarios, k, route, urgent_weight, overtime_weight)
        total += losses
        overtime_total += overtime
        any_late |= late.any(axis=1) | (overtime > 1e-7)
        late_count += late.sum(axis=1)
        for pos, i in enumerate(route):
            count = int(late[:, pos].sum())
            jobs.append({'task_id': instance.tasks[i].id, 'late_probability': count/s_count,
                         'monte_carlo_wilson_95': wilson(count, s_count)})
    return {'scenario_count': s_count, 'scenario_origin': scenarios.origin, 'scenario_seed': scenarios.seed,
            'alpha': alpha, 'mean_weighted_loss_minutes': float(total.mean()),
            'cvar_weighted_loss_minutes': cvar(total, alpha),
            'mean_late_tasks': float(late_count.mean()),
            'mean_overtime_minutes': float(overtime_total.mean()),
            'probability_any_window_or_shift_violation': float(any_late.mean()),
            'jobs': jobs,
            'warning': 'Probabilities are conditional on the supplied scenario model. Monte Carlo intervals do not include model error or distribution shift.'}


def change_cost(instance: Instance, owner: int, route, reassignment_cost=1.0, resequence_cost=.25):
    engineer = instance.engineers[owner].id
    value = 0.0
    predecessor = None
    for i in route:
        tid = instance.tasks[i].id
        previous = instance.previous_assignment.get(tid)
        if previous is not None and previous != engineer:
            value += reassignment_cost
        if tid in instance.previous_predecessor and instance.previous_predecessor[tid] != predecessor:
            value += resequence_cost
        predecessor = tid
    return value


def risk_recombine(instance: Instance, pool, incumbent, scenarios: Scenarios,
                   seconds=10.0, distance_tolerance=.05, alpha=.95, mean_weight=.25,
                   stability_weight=0.0, fleet_allowance=0, max_task_late_probability=None):
    """Keep incumbent coverage/urgent counts; optimize CVaR inside an explicit km budget.

    fleet_allowance=0 keeps the same number of resources (or fewer). A positive
    allowance is an explicit business-policy relaxation, never silently enabled.
    max_task_late_probability is an empirical scenario filter, not a certificate.
    """
    if distance_tolerance < 0 or not 0 <= alpha < 1 or fleet_allowance < 0:
        raise ValueError('Invalid risk policy')
    if mean_weight < 0 or stability_weight < 0:
        raise ValueError('Risk weights must be nonnegative')
    if max_task_late_probability is not None and not 0 <= max_task_late_probability <= 1:
        raise ValueError('Probability threshold must be in [0, 1]')
    t0 = perf_counter()
    ev = Evaluator(instance)
    ev.key(incumbent)
    scenarios.validate(ev)
    pool = [set(r) for r in pool]
    for owner, route in enumerate(incumbent):
        if route:
            pool[owner].add(route)
    columns, a, lb, ub, upper, objs = build_master(ev, pool)
    p, n, s_count = len(columns), len(instance.tasks), scenarios.travel.shape[0]
    losses = np.zeros((s_count, p))
    for col, (owner, route) in enumerate(columns):
        loss, late, _ = outcomes(ev, scenarios, owner, route)
        losses[:, col] = loss
        if max_task_late_probability is not None and late.mean(axis=0).max(initial=0) > max_task_late_probability:
            upper[col] = 0
    total_vars = p+n+1+s_count
    extended = hstack([a, csc_matrix((a.shape[0], 1+s_count))], format='csc')
    matrices, lower, higher = [extended], list(lb), list(ub)
    key = ev.key(incumbent)
    obj_by_name = {name: c for name, c in objs}
    core = [('unassigned_rank1', key[0]), ('unassigned_rank2', key[1]), ('unassigned_rank3', key[2]), ('new_active_engineers', key[3])]
    for j, (name, value) in enumerate(core):
        row = np.r_[obj_by_name[name], np.zeros(1+s_count)]
        matrices.append(csc_matrix(row.reshape(1, -1)))
        lower.append(value if j < 3 else 0)
        higher.append(value if j < 3 else value+fleet_allowance)
    distance_budget = int(math.floor(key[4]*(1+distance_tolerance)))
    matrices.append(csc_matrix(np.r_[obj_by_name['distance_m'], np.zeros(1+s_count)].reshape(1, -1)))
    lower.append(0)
    higher.append(distance_budget)
    # z_s + eta - total_loss_s >= 0. Shared scenarios preserve cross-route correlation.
    risk_constraints = hstack([-csc_matrix(losses), csc_matrix((s_count, n)),
                               csc_matrix(np.ones((s_count, 1))), eye(s_count, format='csc')], format='csc')
    matrices.append(risk_constraints)
    lower.extend(np.zeros(s_count))
    higher.extend(np.full(s_count, np.inf))
    c = np.zeros(total_vars)
    c[:p] = mean_weight*losses.mean(axis=0)
    c[:p] += stability_weight*np.array([change_cost(instance, owner, route) for owner, route in columns])
    c[p+n] = 1
    c[p+n+1:] = 1/((1-alpha)*s_count)
    matrix = vstack(matrices, format='csc')
    remaining = seconds-(perf_counter()-t0)
    if remaining <= .01:
        return incumbent, {'status': 'PRECOMPUTATION_EXHAUSTED_BUDGET', 'accepted': False}
    result = milp(c, integrality=np.r_[np.ones(p+n), np.zeros(1+s_count)],
                  bounds=Bounds(np.zeros(total_vars), np.r_[upper, np.full(1+s_count, np.inf)]),
                  constraints=LinearConstraint(matrix, np.asarray(lower), np.asarray(higher)),
                  options={'time_limit': remaining, 'mip_rel_gap': .005})
    out = incumbent
    accepted = False
    if result.x is not None:
        trial = result.x.copy()
        trial[:p+n] = np.rint(trial[:p+n])
        values = matrix @ trial
        if (np.all(values >= np.asarray(lower)-1e-5) and np.all(values <= np.asarray(higher)+1e-5)
                and np.all(trial[:p+n] >= 0) and np.all(trial[:p+n] <= upper)):
            proposed = decode_solution(trial, columns, len(instance.engineers))
            pkey = ev.key(proposed)
            if pkey[:3] == key[:3] and pkey[3] <= key[3]+fleet_allowance and pkey[4] <= distance_budget:
                # Avoid accepting a worse risk objective after a short MIP run.
                before = evaluate_risk(instance, incumbent, scenarios, alpha)
                after = evaluate_risk(instance, proposed, scenarios, alpha)
                before_value = before['cvar_weighted_loss_minutes']+mean_weight*before['mean_weighted_loss_minutes']
                after_value = after['cvar_weighted_loss_minutes']+mean_weight*after['mean_weighted_loss_minutes']
                before_value += stability_weight*sum(change_cost(instance, k, r) for k, r in enumerate(incumbent))
                after_value += stability_weight*sum(change_cost(instance, k, r) for k, r in enumerate(proposed))
                incumbent_passes = True
                if max_task_late_probability is not None:
                    incumbent_passes = all(j['late_probability'] <= max_task_late_probability for j in before['jobs'])
                if ((after_value < before_value-1e-6 or (after_value <= before_value+1e-6 and pkey[4] <= key[4]))
                        or not incumbent_passes):
                    out, accepted = proposed, True
    return out, {'status': str(result.message), 'accepted': accepted, 'elapsed_seconds': perf_counter()-t0,
                 'distance_budget_m': distance_budget, 'fleet_allowance': fleet_allowance,
                 'empirical_probability_cap': max_task_late_probability,
                 'risk_cap_certified': False,
                 'note': 'A finite-pool scenario optimization. Evaluate the final choice on independent scenarios/days.'}

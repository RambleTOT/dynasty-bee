"""Нижняя оценка числа инженеров при том же покрытии.

Упрощение: дорога и порядок визитов не учитываются, остаются навыки, транспорт,
покрытие заявок и суммарная работа в смене. Любой настоящий план допустим и для
упрощённой задачи, поэтому её оценка — честная нижняя граница для этой модели.
"""
from __future__ import annotations

import math

import numpy as np
from scipy.optimize import Bounds, LinearConstraint, milp
from scipy.sparse import csc_matrix, lil_matrix

from .evaluate import Evaluator


def personnel_lower_bound(instance, routes, seconds=3.0):
    """Сколько инженеров нужно как минимум при том же числе неназначенных заявок."""
    ev = Evaluator(instance)
    # objective = (аварии, подключения, остальное, инженеры, метры, штраф)
    objective = ev.key(routes)
    unassigned_urgent = objective[0]
    unassigned_total = objective[0] + objective[1] + objective[2]
    found_engineers = objective[3]
    n, k = len(instance.tasks), len(instance.engineers)
    if n == 0:
        return {'lower_bound_engineers': int(ev.a.used.sum()), 'found_engineers': found_engineers,
                'conditional_on': {'unassigned_urgent': 0, 'unassigned_total': 0}, 'status': 'EMPTY'}

    # Пары (инженер, заявка), которые хотя бы по одиночке укладываются в окно и смену.
    a_ = ev.a
    pairs = [(owner, i) for owner in range(k) for i in range(n)
             if a_.allowed[owner, i]
             and max(a_.opening[i], a_.shift_start[owner]) <= a_.closing[i]
             and max(a_.opening[i], a_.shift_start[owner]) + a_.service[owner, i] <= a_.shift_end[owner]]
    p = len(pairs)

    # Переменные: x[пара], «без исполнителя»[заявка], y[инженер задействован].
    # Строки: покрытие заявок, работа ≤ смена, x ≤ y, фиксированные счётчики неназначенных.
    rows = n + k + p + 2
    a = lil_matrix((rows, p + n + k))
    lower = np.full(rows, -np.inf)
    upper = np.full(rows, np.inf)
    lower[:n] = upper[:n] = 1
    for j, (owner, i) in enumerate(pairs):
        a[i, j] = 1
        a[n + owner, j] = a_.service[owner, i]
        a[n + k + j, j] = 1
        a[n + k + j, p + n + owner] = -1
        upper[n + k + j] = 0
    for i in range(n):
        a[i, p + i] = 1
        a[-2, p + i] = a_.urgent[i]
        a[-1, p + i] = 1
    for owner in range(k):
        a[n + owner, p + n + owner] = -(a_.shift_end[owner] - a_.shift_start[owner])
        upper[n + owner] = 0
    lower[-2] = upper[-2] = unassigned_urgent
    lower[-1] = upper[-1] = unassigned_total

    c = np.r_[np.zeros(p + n), 1 - a_.used]
    result = milp(c, integrality=np.ones(p + n + k),
                  bounds=Bounds(np.zeros(p + n + k), np.ones(p + n + k)),
                  constraints=LinearConstraint(csc_matrix(a), lower, upper),
                  options={'time_limit': seconds, 'mip_rel_gap': 0})
    bound = getattr(result, 'mip_dual_bound', None)
    lower_bound = None
    if bound is not None and np.isfinite(bound):
        lower_bound = int(a_.used.sum()) + math.ceil(bound - 1e-6)
    return {
        'lower_bound_engineers': lower_bound,
        'found_engineers': found_engineers,
        'conditional_on': {'unassigned_urgent': unassigned_urgent,
                           'unassigned_total': unassigned_total},
        'status': str(result.message),
        'note': 'Нижняя граница числа инженеров при том же покрытии и тех же длительностях. '
                'Это не граница по километрам и не гарантия для реального дня.',
    }

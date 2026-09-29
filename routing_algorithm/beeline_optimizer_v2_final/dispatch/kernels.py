"""Простой расчёт маршрутов на numba — единственный источник правды о допустимости.

Никакой ML-слой не может его обойти.
"""
import numpy as np
from numba import njit

NO_DISTANCE = 9_000_000_000_000_000


@njit(cache=True)
def evaluate(k, route, travel, distance, service, nodes, opening, closing,
             allowed, starts, shift_start, shift_end):
    """Проигрывает маршрут инженера k.

    Возвращает (допустим ли, метры, время окончания, минимальный запас в минутах).
    Правила:
        приезд  = конец прошлой работы + дорога
        начало  = max(приезд, начало окна / появление заявки), не позже конца окна
        конец   = начало + работа, не позже конца смены
    """
    now = shift_start[k]
    prev = starts[k]
    metres = 0
    min_slack = shift_end[k] - now
    for idx in route:
        if not allowed[k, idx]:
            return False, 0, now, -1
        node = nodes[idx]
        now += travel[k, prev, node]
        now = max(now, opening[idx])
        if now > closing[idx]:
            return False, 0, now, -1
        min_slack = min(min_slack, closing[idx] - now)
        now += service[k, idx]
        if now > shift_end[k]:
            return False, 0, now, -1
        metres += distance[k, prev, node]
        prev = node
    return True, metres, now, min(min_slack, shift_end[k] - now)


@njit(cache=True)
def insertion_choices(k, route, candidate, min_position, travel, distance, service,
                      nodes, opening, closing, allowed, starts, shift_start, shift_end):
    """Лучшая позиция вставки заявки в маршрут: меньше метров, при равенстве — больше запас.

    Возвращает (позиция или -1, метры, время окончания, запас).
    Позиции раньше min_position (замороженные визиты) не рассматриваются.
    """
    if not allowed[k, candidate]:
        return -1, 0, 0, -1
    best_position = -1
    best_distance = NO_DISTANCE
    best_end = 0
    best_slack = -1
    new = np.empty(len(route) + 1, dtype=np.int64)
    for pos in range(min_position, len(route) + 1):
        for j in range(len(new)):
            if j < pos:
                new[j] = route[j]
            elif j == pos:
                new[j] = candidate
            else:
                new[j] = route[j - 1]
        feasible, dist, end, slack = evaluate(k, new, travel, distance, service, nodes,
                                              opening, closing, allowed, starts,
                                              shift_start, shift_end)
        if feasible and (dist < best_distance or (dist == best_distance and slack > best_slack)):
            best_position, best_distance, best_end, best_slack = pos, dist, end, slack
    return best_position, best_distance, best_end, best_slack

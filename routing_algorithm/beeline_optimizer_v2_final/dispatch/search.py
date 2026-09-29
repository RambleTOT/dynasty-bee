"""Основной поиск: жадная вставка → ALNS → локальные улучшения → сборка из пула маршрутов.

Схема:
1. FIFO и несколько стартовых планов с разными правилами вставки.
2. ALNS: ломаем часть плана одним из шести операторов и чиним вставкой с «сожалением».
3. Все найденные маршруты складываем в пул.
4. MILP выбирает из пула лучшую совместимую комбинацию.
5. Независимый валидатор перепроверяет итог.
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass
from time import perf_counter

import numpy as np

from .evaluate import Evaluator, baseline
from .master import enumerate_all_routes, recombine
from .model import Instance

Routes = list[tuple[int, ...]]

OPERATOR_NAMES = ['random', 'related', 'whole_route', 'worst_arc', 'string', 'time_bottleneck']
N_OPERATORS = len(OPERATOR_NAMES)


@dataclass
class SearchConfig:
    seed: int = 42
    iterations: int = 1000                 # итераций ALNS
    restarts: int = 6                      # стартовых планов
    time_limit_seconds: float = 30.0       # общий бюджет, включая master
    master_seconds: float = 8.0
    use_master: bool = True
    use_local_search: bool = True
    buffer_restarts: tuple[float, ...] = (1.10, 1.20)   # «осторожные» планы с запасом по времени
    max_pool_per_engineer: int = 6000
    exact_small: bool = False              # полный перебор маршрутов — только для малых задач


@dataclass
class SolveResult:
    routes: Routes
    report: dict
    pool: list[set[tuple[int, ...]]]


# --- починка: вставка заявок без исполнителя -----------------------------

def repair(ev: Evaluator, rng: random.Random, routes=None, strategy: int = 0, noise: float = 0.0,
           deadline: float = math.inf) -> Routes:
    """Вставляет свободные заявки по одной, пока есть куда.

    На каждом шаге выбирается заявка с высшим приоритетом, а среди равных —
    по правилу strategy (например, та, у которой меньше всего альтернатив).
    Цена вставки: открывает ли нового инженера, затем прирост метров.
    noise добавляет случайность для разнообразия.
    """
    routes = list(ev.a.locked if routes is None else routes)
    n, k_count = len(ev.instance.tasks), len(routes)
    pending = set(range(n)) - {i for r in routes for i in r}
    random_rank = {i: rng.random() for i in pending}

    while pending and perf_counter() < deadline:
        choice = None
        route_dist = [ev.route(k, r)[1] for k, r in enumerate(routes)]
        for i in sorted(pending):
            alternatives = []
            for k in range(k_count):
                pos, dist, end, slack = ev.insert(k, routes[k], i)
                if pos < 0:
                    continue
                opens_new_engineer = not routes[k] and not ev.a.used[k]
                delta = float(dist - route_dist[k])
                delta += noise * rng.uniform(-1, 1) * max(abs(delta), 300)
                cost = opens_new_engineer * ev.a.fleet_weight + delta
                alternatives.append((cost, -slack, k, pos))
            if not alternatives:
                continue

            alternatives.sort()
            best = alternatives[0]
            # «Сожаление» — насколько хуже вторая/третья альтернатива.
            # Чем оно больше, тем важнее поставить заявку сейчас.
            depth = min(3 if strategy == 1 else 2, len(alternatives))
            regret = sum(alt[0] - best[0] for alt in alternatives[1:depth])
            if len(alternatives) == 1:
                regret += 2 * ev.a.fleet_weight

            priority = int(ev.a.priority_rank[i])
            closing = ev.a.closing[i]
            if strategy in (0, 1):
                rank = (priority, -regret, closing, best[0], i)
            elif strategy == 2:
                rank = (priority, closing, len(alternatives), best[0], i)
            elif strategy == 3:
                rank = (priority, len(alternatives), closing - ev.a.opening[i], best[0], i)
            elif strategy == 4:
                rank = (priority, random_rank[i], best[0], i)
            else:
                rank = (priority, best[0], closing, i)
            if choice is None or rank < choice[0]:
                choice = (rank, i, best[2], best[3])

        if choice is None:
            break
        _, i, k, pos = choice
        routes[k] = routes[k][:pos] + (i,) + routes[k][pos:]
        pending.remove(i)
    return routes


# --- локальные улучшения -------------------------------------------------

def local_descent(ev: Evaluator, routes, deadline=math.inf, max_moves=15) -> Routes:
    """Пробует три вида ходов и берёт лучший: перенос заявки, разворот участка, обмен хвостами.

    Каждый ход перепроверяется полностью (окна, смены), матрицы могут быть несимметричными.
    """
    routes = list(routes)
    for _ in range(max_moves):
        if perf_counter() >= deadline:
            break
        best = None
        best_key = ev.key(routes)

        # 1. Перенос заявки на лучшее место, в том числе к другому инженеру.
        for a, route in enumerate(routes):
            for pos in range(len(ev.a.locked[a]), len(route)):
                i = route[pos]
                reduced = route[:pos] + route[pos + 1:]
                if not ev.route(a, reduced)[0]:
                    continue
                for b in range(len(routes)):
                    target = reduced if b == a else routes[b]
                    loc, _, _, _ = ev.insert(b, target, i)
                    if loc < 0:
                        continue
                    trial = list(routes)
                    trial[a] = reduced
                    trial[b] = target[:loc] + (i,) + target[loc:]
                    key = ev.key(trial)
                    if key < best_key:
                        best, best_key = trial, key
                if perf_counter() >= deadline:
                    break
            if perf_counter() >= deadline:
                break
        if best is not None:
            routes = best
            continue

        # 2. Разворот участка маршрута (2-opt).
        for k, route in enumerate(routes):
            for left in range(len(ev.a.locked[k]), len(route) - 1):
                for right in range(left + 2, len(route) + 1):
                    reversed_route = route[:left] + route[left:right][::-1] + route[right:]
                    if not ev.route(k, reversed_route)[0]:
                        continue
                    trial = list(routes)
                    trial[k] = reversed_route
                    key = ev.key(trial)
                    if key < best_key:
                        best, best_key = trial, key
            if perf_counter() >= deadline:
                break
        if best is not None:
            routes = best
            continue

        # 3. Обмен хвостами двух маршрутов (2-opt*). Замороженное начало не трогаем.
        for a in range(len(routes)):
            if perf_counter() >= deadline:
                break
            for b in range(a + 1, len(routes)):
                for pa in range(len(ev.a.locked[a]), len(routes[a]) + 1):
                    for pb in range(len(ev.a.locked[b]), len(routes[b]) + 1):
                        ra = routes[a][:pa] + routes[b][pb:]
                        rb = routes[b][:pb] + routes[a][pa:]
                        if not ev.route(a, ra)[0] or not ev.route(b, rb)[0]:
                            continue
                        trial = list(routes)
                        trial[a] = ra
                        trial[b] = rb
                        key = ev.key(trial)
                        if key < best_key:
                            best, best_key = trial, key
        if best is None:
            break
        routes = best
    return routes


# --- разрушение: какие заявки снять ---------------------------------------

def destroy(ev: Evaluator, routes, rng: random.Random, operator: int, fraction: float) -> Routes:
    """Снимает часть незамороженных заявок. operator — индекс в OPERATOR_NAMES."""
    movable = [(k, p, i) for k, r in enumerate(routes)
               for p, i in enumerate(r) if p >= len(ev.a.locked[k])]
    if not movable:
        return list(routes)
    q = max(1, min(len(movable), round(fraction * len(movable))))

    if operator == 0:
        # random: случайные заявки
        selected = rng.sample(movable, q)

    elif operator == 1:
        # related: близкие по месту, времени и навыку
        _, _, seed = rng.choice(movable)

        def relatedness(item):
            i = item[2]
            geo = float(np.min(ev.a.distance[:, ev.a.nodes[seed], ev.a.nodes[i]]))
            tw = abs(int(ev.a.opening[seed] - ev.a.opening[i]))
            skill = int(ev.instance.tasks[seed].skill != ev.instance.tasks[i].skill)
            return geo + 80 * tw + 2000 * skill + rng.random() * 500

        selected = sorted(movable, key=relatedness)[:q]

    elif operator == 2:
        # whole_route: снять весь маршрут короткого инженера — прямой путь к «минус один инженер»
        ks = [k for k, r in enumerate(routes) if len(r) > len(ev.a.locked[k])]
        k = min(ks, key=lambda x: len(routes[x]) + rng.random() * 4)
        selected = [x for x in movable if x[0] == k]

    elif operator == 3:
        # worst_arc: заявки, которые дороже всего по километрам
        def marginal(item):
            k, pos, _ = item
            r = routes[k]
            ok, d, _, _ = ev.route(k, r[:pos] + r[pos + 1:])
            return -(ev.route(k, r)[1] - d if ok else -1) + rng.random() * 200

        selected = sorted(movable, key=marginal)[:q]

    elif operator == 4:
        # string: подряд идущий кусок одного маршрута
        k, pos, _ = rng.choice(movable)
        start = max(len(ev.a.locked[k]), min(pos, len(routes[k]) - q))
        selected = [x for x in movable if x[0] == k and start <= x[1] < start + q]

    else:
        # time_bottleneck: заявки с минимальным запасом до конца окна
        slack = {(k, i): row['window_slack_minutes']
                 for k, r in enumerate(routes) for i, row in zip(r, ev.schedule(k, r))}
        selected = sorted(movable, key=lambda x: slack[x[0], x[2]] + rng.random() * 10)[:q]

    removed = {i for _, _, i in selected}
    out = [tuple(i for i in route if i not in removed) for route in routes]
    # Если матрица не метрическая, удаление может сломать маршрут — тогда оставляем только замороженное.
    for k, r in enumerate(out):
        if not ev.route(k, r)[0]:
            out[k] = ev.a.locked[k]
    return out


# --- главный цикл --------------------------------------------------------

def solve(instance: Instance, config: SearchConfig | None = None,
          initial_routes: Routes | None = None) -> SolveResult:
    cfg = config or SearchConfig()
    if cfg.iterations < 0 or cfg.restarts < 1 or cfg.time_limit_seconds <= 0 or cfg.master_seconds < 0:
        raise ValueError('Invalid search budget')
    t0 = perf_counter()
    ev = Evaluator(instance)
    rng = random.Random(cfg.seed)

    for k, r in enumerate(ev.a.locked):
        if not ev.route(k, r)[0]:
            raise ValueError(f'Locked prefix is infeasible for {instance.engineers[k].id}; '
                             f'dispatcher intervention required')

    # Старт: FIFO или переданный план, если он лучше.
    base = baseline(instance)
    best = base
    if initial_routes is not None:
        ev.key(initial_routes)
        if ev.key(initial_routes) < ev.key(best):
            best = list(initial_routes)

    pool = [set() for _ in instance.engineers]

    def collect(routes):
        for k, r in enumerate(routes):
            if r and (len(pool[k]) < cfg.max_pool_per_engineer or r == best[k]):
                pool[k].add(r)

    collect(base)
    collect(best)
    master_reserve = cfg.master_seconds if cfg.use_master else 0
    search_deadline = t0 + max(.1, cfg.time_limit_seconds - master_reserve)
    trace = [{'phase': 'baseline', 'seconds': perf_counter() - t0, 'objective': ev.key(best)}]

    # Несколько стартовых планов с разными правилами вставки.
    for restart in range(cfg.restarts):
        if perf_counter() >= search_deadline:
            break
        candidate = repair(ev, rng, strategy=restart % 6, noise=.12 * (restart > 0),
                           deadline=search_deadline)
        if cfg.use_local_search:
            candidate = local_descent(ev, candidate, min(search_deadline, perf_counter() + 1.0),
                                      max_moves=8)
        collect(candidate)
        if ev.key(candidate) < ev.key(best):
            best = candidate
            trace.append({'phase': 'construction', 'seconds': perf_counter() - t0,
                          'objective': ev.key(best)})

    # ALNS: операторы с адаптивными весами.
    current = list(best)
    weights = [1.0] * N_OPERATORS
    rewards, uses = [0.0] * N_OPERATORS, [0] * N_OPERATORS
    accepted = [0] * N_OPERATORS
    completed_iterations = 0
    for step in range(cfg.iterations):
        if perf_counter() >= search_deadline:
            break
        op = rng.choices(range(N_OPERATORS), weights=weights, k=1)[0]
        damaged = destroy(ev, current, rng, op, rng.uniform(.08, .28))
        candidate = repair(ev, rng, damaged, strategy=rng.choice([0, 0, 1, 2, 3]), noise=.15,
                           deadline=search_deadline)
        if cfg.use_local_search and step % 75 == 74:
            candidate = local_descent(ev, candidate, min(search_deadline, perf_counter() + .6),
                                      max_moves=4)
        collect(candidate)

        ckey, bkey, oldkey = ev.key(candidate), ev.key(best), ev.key(current)
        # Отжиг разрешает временно ухудшить только километры.
        # Покрытие по приоритетам и число инженеров на километры не обмениваются.
        temperature = max(30.0, .08 * max(bkey[4], 1) * (0.995 ** step))
        good = ckey <= oldkey
        if not good and ckey[:4] == oldkey[:4]:
            good = rng.random() < math.exp(min(0.0, (oldkey[4] - ckey[4]) / temperature))

        reward = .1
        if ckey < bkey:
            best = list(candidate)
            reward = 8.0
            trace.append({'phase': 'alns', 'iteration': step + 1,
                          'seconds': perf_counter() - t0, 'objective': ckey})
        elif ckey < oldkey:
            reward = 4.0
        elif good:
            reward = 1.0
        if good:
            current = candidate
            accepted[op] += 1
        rewards[op] += reward
        uses[op] += 1

        if (step + 1) % 40 == 0:
            for j in range(N_OPERATORS):
                if uses[j]:
                    weights[j] = max(.2, .8 * weights[j] + .2 * rewards[j] / uses[j])
            rewards, uses = [0.0] * N_OPERATORS, [0] * N_OPERATORS
        if (step + 1) % 200 == 0:
            current = repair(ev, rng, strategy=4, noise=.2, deadline=search_deadline)
            collect(current)
            if ev.key(current) < ev.key(best):
                best = list(current)
        completed_iterations += 1

    # Планы с запасом по времени пополняют пул для выбора с учётом риска.
    for factor in cfg.buffer_restarts:
        if perf_counter() >= search_deadline:
            break
        buffered = Evaluator(instance, buffer=factor)
        if any(not buffered.route(k, r)[0] for k, r in enumerate(buffered.a.locked)):
            continue
        candidate = repair(buffered, rng, strategy=0, deadline=search_deadline)
        collect(candidate)  # план с запасом заведомо допустим и без запаса
        if ev.key(candidate) < ev.key(best):
            best = candidate

    # Сборка лучшей комбинации из пула.
    master_meta = {'enabled': False}
    complete = False
    if cfg.exact_small:
        pool = enumerate_all_routes(ev)
        complete = True
    pre_master_objective = list(ev.key(best))
    if cfg.use_master:
        budget = min(cfg.master_seconds, max(.02, cfg.time_limit_seconds - (perf_counter() - t0)))
        best, master_meta = recombine(ev, pool, best, budget, complete_pool=complete)
        master_meta['enabled'] = True

    from .validation import validate_plan
    if tuple(validate_plan(instance, best)) != tuple(ev.key(best)):
        raise RuntimeError('Independent validator and search evaluator disagree')

    meta = {
        'algorithm': 'ALNS + feasible local search + lexicographic HiGHS route-pool master',
        'pre_master_objective': pre_master_objective,
        'seed': cfg.seed,
        'iterations_completed': completed_iterations,
        'elapsed_seconds': perf_counter() - t0,
        'master': master_meta,
        'operator_names': list(OPERATOR_NAMES),
        'operator_final_weights': weights,
        'operator_accepted': accepted,
        'trace': trace,
        'baseline_objective': list(ev.key(base)),
        'limitations': [
            'Travel matrices are static for this planning snapshot.',
            'No global optimality claim unless complete enumeration and every master stage are certified.',
            'Configured wall time is a soft budget; a kernel/MIP call may slightly overrun.',
        ],
    }
    return SolveResult(best, ev.report(best, meta), pool)

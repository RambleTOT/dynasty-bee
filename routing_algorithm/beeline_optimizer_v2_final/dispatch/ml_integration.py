"""Как ML помогает планировщику, не ломая бизнес-правил.

1. Прогноз длительности P50/P90 можно подставить вместо норматива.
2. После обычного плана ML выбирает из того же пула маршрутов более надёжную
   комбинацию. Покрытие по приоритетам, число инженеров и время реакции на аварии
   при этом не ухудшаются, рост пробега ограничен.
"""
from __future__ import annotations
from dataclasses import dataclass, replace
import numpy as np
import pandas as pd
from scipy.optimize import milp, Bounds, LinearConstraint
from scipy.sparse import vstack, csc_matrix

from .model import Instance
from .evaluate import Evaluator
from .master import build_master, encode_solution, decode_solution
from .production import solve_production, ProductionConfig
from .validation import validate_plan
from .ml_risk import OperationalRiskBundle


@dataclass
class MLEnhancementConfig:
    service_quantile: str = 'normative'  # normative | p50 | p90 — какую длительность использовать
    rerank_by_risk: bool = True
    max_distance_increase: float = 0.03  # на сколько можно увеличить пробег ради надёжности
    late_weight: float = 0.25            # вес риска опоздания
    first_fix_weight: float = 0.0        # оставлен для совместимости старых конфигов
    success_weight: float = 1.0
    uncertainty_weight: float = 0.15
    mip_seconds: float = 1.5
    max_routes_per_engineer: int = 120
    # Риск аварии весит больше риска подключения, подключения — больше остального.
    priority_risk_weights: tuple[float, float, float] = (3.0, 1.5, 1.0)
    protect_urgent_response: bool = True


def _pair_table(instance: Instance, features: pd.DataFrame) -> pd.DataFrame:
    need = {'engineer_id', 'request_id'}
    if not need.issubset(features):
        raise ValueError('pair features require engineer_id and request_id')
    return features.copy()


def service_matrix(instance: Instance, features: pd.DataFrame,
                   bundle: OperationalRiskBundle, quantile: str = 'p50') -> np.ndarray:
    """Матрица K × N прогнозной длительности работ (минуты, не меньше 1)."""
    pair = _pair_table(instance, features).set_index(['engineer_id', 'request_id'], drop=False)
    rows, keys = [], []
    for e in instance.engineers:
        for t in instance.tasks:
            key = (e.id, t.id)
            if key not in pair.index:
                raise ValueError(f'Missing ML feature row for pair {key}')
            row = pair.loc[key]
            if isinstance(row, pd.DataFrame):
                row = row.iloc[0]
            rows.append(row)
            keys.append(key)
    frame = pd.DataFrame(rows).reset_index(drop=True)
    pred = bundle.predict_duration(frame, quantile)
    out = np.empty((len(instance.engineers), len(instance.tasks)), dtype=int)
    q = 0
    for k in range(len(instance.engineers)):
        for i in range(len(instance.tasks)):
            out[k, i] = max(1, int(round(pred[q])))
            q += 1
    return out


def _route_risk(ev: Evaluator, k: int, route: tuple[int, ...], pair: pd.DataFrame,
                bundle: OperationalRiskBundle, cfg: MLEnhancementConfig) -> tuple[float, list[dict]]:
    """Риск одного маршрута и разбивка по визитам."""
    if not route:
        return 0.0, []
    schedule = ev.schedule(k, route)
    e = ev.instance.engineers[k]
    rows = []
    for pos, (i, s) in enumerate(zip(route, schedule), 1):
        t = ev.instance.tasks[i]
        key = (e.id, t.id)
        if key not in pair.index:
            raise ValueError(f'Missing ML feature row for pair {key}')
        row = pair.loc[key]
        if isinstance(row, pd.DataFrame):
            row = row.iloc[0]
        row = row.to_dict()
        row.update({'planned_start_minute': s['start_minute'], 'slack_minutes': s['window_slack_minutes'],
                    'planned_travel_minutes': s['travel_minutes'], 'route_position': pos})
        rows.append(row)
    frame = pd.DataFrame(rows)
    # Прогноз длительности — признак для модели опоздания (известен до выезда).
    frame['predicted_duration_p50'] = bundle.predict_duration(frame, 'p50')
    frame['predicted_duration_p90'] = bundle.predict_duration(frame, 'p90')
    ff = bundle.predict_first_fix(frame)
    late = bundle.predict_late(frame)
    success = bundle.predict_operational_success(frame)
    p50 = frame['predicted_duration_p50'].to_numpy(dtype=float)
    p90 = frame['predicted_duration_p90'].to_numpy(dtype=float)
    uncertainty = np.maximum(0.0, p90 - p50) / np.maximum(1.0, p50)
    risk = cfg.success_weight * (1 - success) + cfg.late_weight * late + cfg.uncertainty_weight * uncertainty
    details = [{'request_id': ev.instance.tasks[i].id, 'p_first_time_fix': float(a),
                'p_late_start': float(b), 'p_operational_success': float(c),
                'duration_uncertainty_ratio': float(u), 'risk': float(r)}
               for i, a, b, c, u, r in zip(route, ff, late, success, uncertainty, risk)]
    return float(risk.sum()), details


def _score_route_columns(ev: Evaluator, columns, pair: pd.DataFrame,
                         bundle: OperationalRiskBundle, cfg: MLEnhancementConfig):
    """Риск каждого маршрута пула. Все визиты оцениваются одним пакетом."""
    rows = []
    owners = []
    for col, (k, route) in enumerate(columns):
        sched = ev.schedule(k, route)
        e = ev.instance.engineers[k]
        for pos, (i, st) in enumerate(zip(route, sched), 1):
            key = (e.id, ev.instance.tasks[i].id)
            if key not in pair.index:
                raise ValueError(f'Missing ML feature row for pair {key}')
            r = pair.loc[key]
            if isinstance(r, pd.DataFrame):
                r = r.iloc[0]
            d = r.to_dict()
            d.update({'planned_start_minute': st['start_minute'],
                      'slack_minutes': st['window_slack_minutes'],
                      'planned_travel_minutes': st['travel_minutes'],
                      'route_position': pos})
            rows.append(d)
            owners.append((col, i))
    risk = np.zeros(len(columns), dtype=float)
    details = {}
    if not rows:
        return risk, details
    frame = pd.DataFrame(rows)
    frame['predicted_duration_p50'] = bundle.predict_duration(frame, 'p50')
    frame['predicted_duration_p90'] = bundle.predict_duration(frame, 'p90')
    ff = bundle.predict_first_fix(frame)
    late = bundle.predict_late(frame)
    success = bundle.predict_operational_success(frame)
    p50 = frame['predicted_duration_p50'].to_numpy(dtype=float)
    p90 = frame['predicted_duration_p90'].to_numpy(dtype=float)
    uncertainty = np.maximum(0.0, p90 - p50) / np.maximum(1.0, p50)
    base = cfg.success_weight * (1 - success) + cfg.late_weight * late + cfg.uncertainty_weight * uncertainty
    for (col, i), a, b, c, u, r0 in zip(owners, ff, late, success, uncertainty, base):
        rank = int(ev.instance.tasks[i].priority_rank)
        w = float(cfg.priority_risk_weights[max(0, min(2, rank - 1))])
        r = float(r0) * w
        risk[col] += r
        details.setdefault(col, []).append({
            'request_id': ev.instance.tasks[i].id,
            'priority_rank': rank,
            'p_first_time_fix': float(a),
            'p_late_start': float(b),
            'p_operational_success': float(c),
            'duration_uncertainty_ratio': float(u),
            'priority_weight': w,
            'risk': r,
        })
    return risk, details


def rerank_pool_by_risk(instance: Instance, deterministic_routes, pool, features: pd.DataFrame,
                        bundle: OperationalRiskBundle, cfg: MLEnhancementConfig):
    """Выбирает из пула более надёжную комбинацию маршрутов.

    Не меняет покрытие по приоритетам, не увеличивает число инженеров и время
    реакции на аварии, пробег растёт не больше чем на max_distance_increase.
    Если выигрыша по риску нет — возвращает исходный план.
    """
    ev = Evaluator(instance)
    pair = _pair_table(instance, features).set_index(['engineer_id', 'request_id'], drop=False)
    pool = [set(x) for x in pool]
    for k, r in enumerate(deterministic_routes):
        if r:
            pool[k].add(tuple(r))
    # В пуле ALNS тысячи почти одинаковых маршрутов. Оставляем ограниченный набор,
    # исходный маршрут — всегда.
    for k in range(len(pool)):
        inc = tuple(deterministic_routes[k])
        ranked = sorted(pool[k], key=lambda r: (-len(r), ev.route(k,r)[1], r))
        keep = set(ranked[:max(1,cfg.max_routes_per_engineer)])
        if inc:
            keep.add(inc)
        pool[k] = keep
    columns, A, lb, ub, upper, objectives = build_master(ev, pool)
    if not columns:
        return deterministic_routes, {'accepted': False, 'reason': 'empty_pool'}
    start_x = encode_solution(deterministic_routes, columns, len(instance.tasks))
    obj = {name: c for name, c in objectives}
    fixed_rows, lo, hi = [], [], []
    # Покрытие по приоритетам не меняется.
    for name in ('unassigned_rank1', 'unassigned_rank2', 'unassigned_rank3'):
        c = obj[name]
        v = float(c @ start_x)
        fixed_rows.append(c)
        lo.append(v)
        hi.append(v)
    # Инженеров не больше.
    c = obj['new_active_engineers']
    v = float(c @ start_x)
    fixed_rows.append(c)
    lo.append(-np.inf)
    hi.append(v)
    # Пробег — в пределах допуска.
    cdist = obj['distance_m']
    d0 = float(cdist @ start_x)
    fixed_rows.append(cdist)
    lo.append(-np.inf)
    hi.append(d0 * (1 + cfg.max_distance_increase))
    if 'soft_penalty' in obj:
        c = obj['soft_penalty']
        v = float(c @ start_x)
        fixed_rows.append(c)
        lo.append(-np.inf)
        hi.append(v)
    risk_c = np.zeros(len(columns)+len(instance.tasks))
    column_risk, detail_by_col = _score_route_columns(ev, columns, pair, bundle, cfg)
    risk_c[:len(columns)] = column_risk

    # Время реакции на аварии не ухудшается: для каждого маршрута считаем суммарную
    # задержку начала аварий от самого раннего возможного старта.
    urgent_delay_c = np.zeros(len(columns)+len(instance.tasks))
    if cfg.protect_urgent_response:
        for j, (k, route) in enumerate(columns):
            sched = ev.schedule(k, route)
            total = 0.0
            for i, st in zip(route, sched):
                t = instance.tasks[i]
                if t.priority_rank == 1:
                    earliest = max(t.window_start, t.release_time)
                    total += max(0, int(st['start_minute']) - int(earliest))
            urgent_delay_c[j] = total
        urgent0 = float(urgent_delay_c @ start_x)
        fixed_rows.append(urgent_delay_c)
        lo.append(-np.inf)
        hi.append(urgent0)
    route_details = {(k, r): detail_by_col.get(j, []) for j, (k, r) in enumerate(columns)}
    mat = vstack([A] + [csc_matrix(x.reshape(1, -1)) for x in fixed_rows], format='csc')
    lower = np.r_[lb, lo]
    upper_c = np.r_[ub, hi]
    result = milp(risk_c, integrality=np.ones(len(risk_c)), bounds=Bounds(np.zeros(len(risk_c)), upper),
                  constraints=LinearConstraint(mat, lower, upper_c),
                  options={'time_limit': max(.05, cfg.mip_seconds), 'mip_rel_gap': 0.0})
    if result.x is None:
        return deterministic_routes, {'accepted': False, 'reason': 'risk_mip_no_solution'}
    trial = np.rint(result.x)
    routes = decode_solution(trial, columns, len(instance.engineers))
    validate_plan(instance, routes)
    old_key, new_key = ev.key(deterministic_routes), ev.key(routes)
    # Отдельная проверка поверх ограничений MILP.
    safe = (new_key[:3] == old_key[:3] and new_key[3] <= old_key[3]
            and new_key[4] <= old_key[4] * (1 + cfg.max_distance_increase) + 1)
    if not safe:
        return deterministic_routes, {'accepted': False, 'reason': 'post_validation_guard',
                                      'before': old_key, 'candidate': new_key}
    old_risk = float(risk_c @ start_x)
    new_risk = float(risk_c @ trial)
    if new_risk >= old_risk - 1e-9:
        return deterministic_routes, {'accepted': False, 'reason': 'no_risk_improvement',
                                      'risk_before': old_risk, 'risk_after': new_risk}
    return routes, {'accepted': True, 'risk_before': old_risk, 'risk_after': new_risk,
                    'objective_before': list(old_key), 'objective_after': list(new_key),
                    'distance_cap_pct': cfg.max_distance_increase * 100,
                    'urgent_delay_before': float(urgent_delay_c @ start_x) if cfg.protect_urgent_response else None,
                    'urgent_delay_after': float(urgent_delay_c @ trial) if cfg.protect_urgent_response else None,
                    'selected_details': {instance.engineers[k].id: route_details.get((k, r), [])
                                         for k, r in enumerate(routes)}}


def solve_with_ml(instance: Instance, features: pd.DataFrame, bundle: OperationalRiskBundle,
                  production_config: ProductionConfig | None = None,
                  ml_config: MLEnhancementConfig | None = None):
    """План с ML: прогноз длительности вместо норматива и выбор более надёжного варианта."""
    cfg = ml_config or MLEnhancementConfig()
    work = instance
    if cfg.service_quantile.lower() in ('p50', 'p90'):
        sm = service_matrix(instance, features, bundle, cfg.service_quantile.lower())
        work = replace(instance, service_by_engineer=sm)
    result = solve_production(work, production_config)
    result.report['ml'] = {'enabled': True, 'origin': bundle.origin,
                           'service_quantile': cfg.service_quantile, 'rerank': None}
    if cfg.rerank_by_risk:
        routes, meta = rerank_pool_by_risk(work, result.routes, result.pool, features, bundle, cfg)
        result.routes = routes
        result.report = Evaluator(work).report(routes, result.report.get('metadata', {}))
        result.report['ml'] = {'enabled': True, 'origin': bundle.origin,
                               'service_quantile': cfg.service_quantile, 'rerank': meta}
    return result

"""Исследовательский режим: ALNS → сборка из пула → column generation со взвешенной целью → MILP.

Оставлен для сравнения. Основной путь — production.py, лексикографический CG — hybrid_v2.py.
"""
from __future__ import annotations
from dataclasses import dataclass
from time import perf_counter

from .model import Instance
from .evaluate import Evaluator
from .search import solve as alns_solve, SearchConfig, SolveResult
from .column_generation import column_generate, CGConfig
from .master import recombine
from .validation import validate_plan


@dataclass
class HybridConfig:
    seed: int = 42
    total_seconds: float = 60.0
    warm_start_seconds: float = 10.0
    warm_start_iterations: int = 1200
    pre_master_seconds: float = 4.0
    cg_seconds: float = 34.0
    final_mip_seconds: float = 12.0
    cg: CGConfig | None = None


def solve_hybrid(instance: Instance, config: HybridConfig | None = None) -> SolveResult:
    cfg = config or HybridConfig()
    if cfg.total_seconds <= 0:
        raise ValueError('total_seconds must be positive')
    t0 = perf_counter()
    ev = Evaluator(instance)

    # 1) Быстрый ALNS: стартовый план и пул допустимых маршрутов.
    warm_budget = min(cfg.warm_start_seconds, cfg.total_seconds)
    warm = alns_solve(
        instance,
        SearchConfig(seed=cfg.seed, iterations=cfg.warm_start_iterations, restarts=6,
                     time_limit_seconds=max(.1, warm_budget), master_seconds=0,
                     use_master=False, buffer_restarts=()),
    )
    pool = [set(x) for x in warm.pool]
    for k, r in enumerate(warm.routes):
        if r:
            pool[k].add(tuple(r))

    # 2) Сразу собираем лучшую комбинацию из пула — надёжный запасной план.
    elapsed = perf_counter()-t0
    pre_budget = min(cfg.pre_master_seconds, max(.02, cfg.total_seconds-elapsed))
    incumbent, pre_master_meta = recombine(ev, pool, warm.routes, seconds=pre_budget, complete_pool=False)

    # 3) LP и pricing по двойственным ценам добавляют маршруты, которые ALNS не нашёл.
    elapsed = perf_counter()-t0
    reserve = cfg.final_mip_seconds
    cg_budget = min(cfg.cg_seconds, max(.1, cfg.total_seconds-elapsed-reserve))
    cgc = cfg.cg or CGConfig()
    cgc = CGConfig(**{**cgc.__dict__, 'time_limit_seconds': cg_budget})
    cg = column_generate(ev, pool, cgc, incumbent=incumbent)

    # 4) Целочисленная сборка по приоритетам: аварии → покрытие → инженеры → км.
    elapsed = perf_counter()-t0
    mip_budget = min(cfg.final_mip_seconds, max(.02, cfg.total_seconds-elapsed))
    final_routes, master_meta = recombine(ev, cg.pool, incumbent, seconds=mip_budget, complete_pool=False)
    key = validate_plan(instance, final_routes)
    if tuple(key) != tuple(ev.key(final_routes)):
        raise RuntimeError('Independent validator disagrees with hybrid evaluator')

    meta = {
        'algorithm': 'ALNS route generation + route-pool incumbent master + dual-guided column generation + lexicographic integer master',
        'seed': cfg.seed,
        'elapsed_seconds': perf_counter()-t0,
        'raw_warm_start_objective': list(ev.key(warm.routes)),
        'warm_start_objective': list(ev.key(incumbent)),
        'pre_master': pre_master_meta,
        'cg': {
            'iterations': cg.iterations,
            'columns_added': cg.columns_added,
            'pricing_certified': cg.pricing_certified,
            'final_lp_objective_scaled': cg.lp.objective_scaled,
            'trace': cg.trace,
        },
        'final_master': master_meta,
        'limitations': [
            'Global integer optimality is not claimed: that would require complete route enumeration or branch-and-price.',
            'When pricing hits time/label caps, absence of a negative column is not a proof that none exists.',
            'Travel matrices are static for the planning snapshot; uncertainty is handled by a separate risk layer.'
        ],
    }
    return SolveResult(final_routes, ev.report(final_routes, meta), cg.pool)

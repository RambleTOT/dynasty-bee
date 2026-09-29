"""Расширенный режим: ALNS → сборка из пула → лексикографический column generation → MILP.

Включается через ProductionConfig(use_column_generation=True).
Более важная цель никогда не ухудшается ради менее важной.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from time import perf_counter

from .model import Instance
from .evaluate import Evaluator
from .search import solve as alns_solve, SearchConfig, SolveResult
from .lexicographic_cg import column_generate_lexicographic, LexCGConfig
from .master import recombine
from .validation import validate_plan


@dataclass
class HybridV2Config:
    seed: int = 42
    total_seconds: float = 60.0
    warm_start_seconds: float = 10.0
    warm_start_iterations: int = 1200
    pre_master_seconds: float = 4.0
    lex_cg_seconds: float = 34.0
    final_mip_seconds: float = 12.0
    lex_cg: LexCGConfig | None = None


def solve_hybrid_v2(instance: Instance, config: HybridV2Config | None = None,
                    initial_routes: list[tuple[int, ...]] | None = None) -> SolveResult:
    cfg = config or HybridV2Config()
    if cfg.total_seconds <= 0:
        raise ValueError('total_seconds must be positive')
    t0 = perf_counter()
    ev = Evaluator(instance)

    # 1) Быстрый ALNS: стартовый план и пул маршрутов.
    warm_budget = min(cfg.warm_start_seconds, cfg.total_seconds)
    warm = alns_solve(
        instance,
        SearchConfig(seed=cfg.seed, iterations=cfg.warm_start_iterations, restarts=6,
                     time_limit_seconds=max(.1, warm_budget), master_seconds=0,
                     use_master=False, buffer_restarts=()),
        initial_routes=initial_routes,
    )
    pool = [set(x) for x in warm.pool]
    for k, r in enumerate(warm.routes):
        if r:
            pool[k].add(tuple(r))

    # 2) Сначала собираем лучшее из уже найденного.
    elapsed = perf_counter()-t0
    pre_budget = min(cfg.pre_master_seconds, max(.02, cfg.total_seconds-elapsed))
    incumbent, pre_meta = recombine(ev, pool, warm.routes, seconds=pre_budget, complete_pool=False)

    # 3) CG по очереди целей — без взвешенных компромиссов между приоритетами.
    elapsed = perf_counter()-t0
    reserve = cfg.final_mip_seconds
    cg_budget = min(cfg.lex_cg_seconds, max(.05, cfg.total_seconds-elapsed-reserve))
    base_cfg = cfg.lex_cg or LexCGConfig()
    lex_cfg = LexCGConfig(**{**base_cfg.__dict__, 'time_limit_seconds': cg_budget})
    cg = column_generate_lexicographic(ev, pool, lex_cfg, incumbent=incumbent)

    # 4) Целочисленная сборка в том же порядке приоритетов.
    elapsed = perf_counter()-t0
    mip_budget = min(cfg.final_mip_seconds, max(.02, cfg.total_seconds-elapsed))
    final_routes, master_meta = recombine(ev, cg.pool, incumbent, seconds=mip_budget, complete_pool=False)
    key = validate_plan(instance, final_routes)
    if tuple(key) != tuple(ev.key(final_routes)):
        raise RuntimeError('Independent validator disagrees with v2 evaluator')

    meta = {
        'algorithm': ('ALNS feasible warm start + route-pool MIP incumbent + '
                      'sequential lexicographic column generation + lexicographic integer master'),
        'seed': cfg.seed,
        'elapsed_seconds': perf_counter()-t0,
        'raw_warm_start_objective': list(ev.key(warm.routes)),
        'warm_start_objective': list(ev.key(incumbent)),
        'pre_master': pre_meta,
        'lexicographic_cg': {
            'columns_added': cg.columns_added,
            'all_stages_certified': cg.all_stages_certified,
            'seconds': cg.seconds,
            'stages': [{
                'stage': s.stage, 'lp_value': s.objective_value,
                'iterations': s.iterations, 'columns_added': s.columns_added,
                'pricing_certified': s.pricing_certified, 'seconds': s.seconds,
            } for s in cg.stages],
        },
        'final_master': master_meta,
        'limitations': [
            'The final integer master is exact only on the generated route pool; global integer optimality needs branch-and-price or complete route enumeration.',
            'A lexicographic LP stage is globally certified only if its unrestricted pricing pass completes for every engineer.',
            'Travel matrices are a planning snapshot; time-dependent uncertainty belongs to the separate risk layer.',
        ],
    }
    return SolveResult(final_routes, ev.report(final_routes, meta), cg.pool)

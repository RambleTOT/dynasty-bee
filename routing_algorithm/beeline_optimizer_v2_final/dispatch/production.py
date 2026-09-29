"""Основная точка входа планировщика.

По умолчанию: жёсткие ограничения → вставка по приоритетам и ALNS →
сборка из пула маршрутов (MILP) → независимый валидатор.
Column generation можно включить отдельно, но в живом режиме он не нужен.
"""
from __future__ import annotations
from dataclasses import dataclass
from .model import Instance
from .search import solve, SearchConfig, SolveResult


@dataclass
class ProductionConfig:
    """Настройки боевого режима. По умолчанию план строится за несколько секунд."""
    seed: int = 42
    total_seconds: float = 5.0
    warm_iterations: int = 650
    restarts: int = 6
    master_seconds: float = 1.2
    use_column_generation: bool = False
    cg_seconds: float = 3.0


def solve_production(instance: Instance, config: ProductionConfig | None = None,
                     initial_routes: list[tuple[int, ...]] | None = None) -> SolveResult:
    """Строит план для участка на день."""
    cfg = config or ProductionConfig()
    if not cfg.use_column_generation:
        return solve(instance, SearchConfig(
            seed=cfg.seed,
            iterations=cfg.warm_iterations,
            restarts=cfg.restarts,
            time_limit_seconds=cfg.total_seconds,
            master_seconds=min(cfg.master_seconds, max(.05, cfg.total_seconds*.35)),
            use_master=True,
            buffer_restarts=(),
        ), initial_routes=initial_routes)

    # Дополнительный режим с column generation. Вынесен отдельно, чтобы медленный
    # эксперимент не мешал основному планировщику.
    from .hybrid_v2 import solve_hybrid_v2, HybridV2Config
    from .lexicographic_cg import LexCGConfig
    return solve_hybrid_v2(instance, HybridV2Config(
        seed=cfg.seed,
        total_seconds=cfg.total_seconds + cfg.cg_seconds,
        warm_start_seconds=max(.5, cfg.total_seconds*.55),
        warm_start_iterations=cfg.warm_iterations,
        pre_master_seconds=min(cfg.master_seconds, .8),
        lex_cg_seconds=cfg.cg_seconds,
        final_mip_seconds=min(cfg.master_seconds, 1.0),
        lex_cg=LexCGConfig(time_limit_seconds=cfg.cg_seconds),
    ), initial_routes=initial_routes)

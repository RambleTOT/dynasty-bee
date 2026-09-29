"""Командная строка: python -m dispatch <команда> ...

Основная команда — production. Остальные нужны для экспериментов и демо.
"""
import argparse
import json
from pathlib import Path

import numpy as np

from . import (HybridConfig, HybridV2Config, Instance, Evaluator, ProductionConfig, SearchConfig,
               solve, solve_hybrid, solve_hybrid_v2)
from .column_generation import CGConfig
from .demo import synthetic_instance
from .lexicographic_cg import LexCGConfig

SUMMARY_KEYS = ['objective', 'planned_count', 'active_engineers_today',
                'future_travel_minutes', 'future_distance_km']


def _add_common(p):
    p.add_argument('--out', default='plan.json', help='куда записать отчёт')
    p.add_argument('--seed', type=int, default=42)
    p.add_argument('--workforce-bound', action='store_true',
                   help='посчитать нижнюю границу числа инженеров')
    risk = p.add_mutually_exclusive_group()
    risk.add_argument('--synthetic-risk', action='store_true',
                      help='стресс-тест на синтетических сценариях (не откалиброван)')
    risk.add_argument('--risk-npz', help='npz со сценариями: travel S×K×V×V и service S×K×N')
    p.add_argument('--risk-origin', default='USER_SUPPLIED_SCENARIOS')
    p.add_argument('--risk-seconds', type=float, default=10)
    p.add_argument('--risk-distance-tolerance', type=float, default=.05)


def _add_cg_budget(p, pricing_seconds: float, max_iterations: int):
    p.add_argument('input')
    p.add_argument('--seconds', type=float, default=60)
    p.add_argument('--warm-seconds', type=float, default=10)
    p.add_argument('--warm-iterations', type=int, default=1200)
    p.add_argument('--pre-master-seconds', type=float, default=4)
    p.add_argument('--cg-seconds', type=float, default=34)
    p.add_argument('--final-master-seconds', type=float, default=12)
    p.add_argument('--pricing-seconds', type=float, default=pricing_seconds)
    p.add_argument('--max-cg-iterations', type=int, default=max_iterations)
    p.add_argument('--candidate-width', type=int, default=24)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description='Планировщик выездных инженеров «Билайн Бизнес»')
    sub = parser.add_subparsers(dest='command', required=True)

    p = sub.add_parser('production', help='основной режим: план на день для участка')
    p.add_argument('input', help='JSON с задачей (Instance)')
    p.add_argument('--seconds', type=float, default=12)
    p.add_argument('--warm-iterations', type=int, default=220)
    _add_common(p)

    p = sub.add_parser('case-demo', help='собрать задачу прямо из CSV кейса и решить')
    p.add_argument('case_root', help='папка с распакованными CSV кейса')
    p.add_argument('--region', required=True)
    p.add_argument('--seconds', type=float, default=12)
    p.add_argument('--save-instance')
    _add_common(p)

    p = sub.add_parser('demo', help='синтетическая задача')
    p.add_argument('--tasks', type=int, default=60)
    p.add_argument('--engineers', type=int, default=12)
    p.add_argument('--pattern', choices=['mixed', 'tight', 'spread', 'clustered'], default='mixed')
    p.add_argument('--save-instance')
    p.add_argument('--iterations', type=int, default=1000)
    p.add_argument('--seconds', type=float, default=30)
    p.add_argument('--master-seconds', type=float, default=8)
    _add_common(p)

    p = sub.add_parser('solve', help='ALNS + сборка из пула с ручными настройками')
    p.add_argument('input')
    p.add_argument('--iterations', type=int, default=1000)
    p.add_argument('--seconds', type=float, default=30)
    p.add_argument('--master-seconds', type=float, default=8)
    p.add_argument('--no-master', action='store_true')
    p.add_argument('--exact-small', action='store_true', help='полный перебор (до 8 заявок)')
    p.add_argument('--ortools-seed-seconds', type=float, default=0)
    _add_common(p)

    p = sub.add_parser('hybrid', help='исследовательский: ALNS + взвешенный column generation')
    _add_cg_budget(p, pricing_seconds=1.5, max_iterations=80)
    _add_common(p)

    p = sub.add_parser('hybrid-v2', help='исследовательский: ALNS + лексикографический column generation')
    _add_cg_budget(p, pricing_seconds=.25, max_iterations=30)
    _add_common(p)
    return parser


def _solve(args):
    """Решает задачу выбранной командой. Возвращает (instance, результат)."""
    if args.command == 'production':
        from .operations import plan
        ins = Instance.load(args.input)
        return ins, plan(ins, ProductionConfig(seed=args.seed, total_seconds=args.seconds,
                                               warm_iterations=args.warm_iterations))

    if args.command == 'case-demo':
        from .case_benchmark import from_case_region
        from .operations import plan
        ins = from_case_region(args.case_root, args.region, args.seed)
        _maybe_save(ins, args.save_instance)
        return ins, plan(ins, ProductionConfig(seed=args.seed, total_seconds=args.seconds))

    if args.command == 'demo':
        ins = synthetic_instance(args.tasks, args.engineers, args.seed, args.pattern)
        _maybe_save(ins, args.save_instance)
        return ins, solve(ins, SearchConfig(seed=args.seed, iterations=args.iterations,
                                            time_limit_seconds=args.seconds,
                                            master_seconds=args.master_seconds))

    if args.command == 'solve':
        ins = Instance.load(args.input)
        initial = None
        if args.ortools_seed_seconds:
            from .ortools_adapter import ortools_seed
            initial = ortools_seed(ins, args.ortools_seed_seconds)
        return ins, solve(ins, SearchConfig(seed=args.seed, iterations=args.iterations,
                                            time_limit_seconds=args.seconds,
                                            master_seconds=args.master_seconds,
                                            use_master=not args.no_master,
                                            exact_small=args.exact_small), initial)

    if args.command == 'hybrid':
        ins = Instance.load(args.input)
        cg = CGConfig(max_iterations=args.max_cg_iterations,
                      pricing_time_per_engineer=args.pricing_seconds,
                      candidate_width=args.candidate_width)
        return ins, solve_hybrid(ins, HybridConfig(
            seed=args.seed, total_seconds=args.seconds,
            warm_start_seconds=args.warm_seconds, warm_start_iterations=args.warm_iterations,
            pre_master_seconds=args.pre_master_seconds, cg_seconds=args.cg_seconds,
            final_mip_seconds=args.final_master_seconds, cg=cg))

    # hybrid-v2
    ins = Instance.load(args.input)
    lex = LexCGConfig(max_iterations_per_stage=args.max_cg_iterations,
                      pricing_time_per_engineer=args.pricing_seconds,
                      candidate_width=args.candidate_width)
    return ins, solve_hybrid_v2(ins, HybridV2Config(
        seed=args.seed, total_seconds=args.seconds,
        warm_start_seconds=args.warm_seconds, warm_start_iterations=args.warm_iterations,
        pre_master_seconds=args.pre_master_seconds, lex_cg_seconds=args.cg_seconds,
        final_mip_seconds=args.final_master_seconds, lex_cg=lex))


def _maybe_save(ins: Instance, path: str | None) -> None:
    if path:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        ins.save(path)


def _apply_risk(args, ins, result, report):
    """Перевыбор маршрутов из пула с учётом сценариев риска."""
    from .risk import Scenarios, evaluate_risk, risk_recombine, synthetic_scenarios
    if args.synthetic_risk:
        scenarios = synthetic_scenarios(ins, 96, args.seed + 10_000)
        holdout = synthetic_scenarios(ins, 256, args.seed + 20_000)
    else:
        with np.load(args.risk_npz, allow_pickle=False) as data:
            scenarios = Scenarios(data['travel'], data['service'], args.risk_origin)
        holdout = None
    chosen, risk_meta = risk_recombine(ins, result.pool, result.routes, scenarios,
                                       args.risk_seconds, args.risk_distance_tolerance)
    new_report = Evaluator(ins).report(chosen, report['metadata'])
    new_report['nominal_optimized_objective'] = result.report['objective']
    new_report['risk_optimization'] = risk_meta
    new_report['risk_in_sample'] = evaluate_risk(ins, chosen, scenarios)
    if holdout is not None:
        new_report['risk_holdout_before'] = evaluate_risk(ins, result.routes, holdout)
        new_report['risk_holdout_after'] = evaluate_risk(ins, chosen, holdout)
    result.routes = chosen
    return new_report


def main():
    args = build_parser().parse_args()
    ins, result = _solve(args)
    report = result.report
    if args.synthetic_risk or args.risk_npz:
        report = _apply_risk(args, ins, result, report)
    if args.workforce_bound:
        from .bounds import personnel_lower_bound
        report['workforce_bound'] = personnel_lower_bound(ins, result.routes)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')
    print(json.dumps({k: report[k] for k in SUMMARY_KEYS}, ensure_ascii=False, indent=2))
    print(f'Written: {out}')


if __name__ == '__main__':
    main()

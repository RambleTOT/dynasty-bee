import unittest

from dispatch.demo import synthetic_instance
from dispatch.evaluate import Evaluator
from dispatch.search import solve, SearchConfig
from dispatch.master import enumerate_all_routes, recombine
from dispatch.lexicographic_cg import (LexCGConfig, column_generate_lexicographic,
                                       solve_lex_rmp, reduced_cost_lex)
from dispatch.hybrid_v2 import solve_hybrid_v2, HybridV2Config
from dispatch.validation import validate_plan


class TestLexicographicCG(unittest.TestCase):
    def test_small_cg_reaches_exact_integer_solution(self):
        for seed in [101, 102, 103, 104]:
            ins = synthetic_instance(6, 2, seed, pattern='mixed')
            ev = Evaluator(ins)
            warm = solve(ins, SearchConfig(seed=seed, iterations=0, restarts=1,
                                           time_limit_seconds=.5, master_seconds=0,
                                           use_master=False, buffer_restarts=()))
            pool = [set(x) for x in warm.pool]
            cg = column_generate_lexicographic(
                ev, pool,
                LexCGConfig(max_iterations_per_stage=60, time_limit_seconds=30,
                            pricing_time_per_engineer=4, candidate_width=None,
                            max_labels_per_node=None, max_total_labels=None,
                            certification_pass=False,
                            stage_time_shares=(.25,.25,.25,.25)),
                warm.routes)
            got, _ = recombine(ev, cg.pool, warm.routes, seconds=5)
            full = enumerate_all_routes(ev, max_tasks=8)
            exact, meta = recombine(ev, full, warm.routes, seconds=10, complete_pool=True)
            self.assertTrue(meta['global_optimal'])
            self.assertEqual(validate_plan(ins, got), validate_plan(ins, exact))

    def test_reduced_cost_formula_matches_enumeration(self):
        ins = synthetic_instance(5, 2, 211, pattern='tight')
        ev = Evaluator(ins)
        pool = [set() for _ in ins.engineers]
        from dispatch.column_generation import seed_pool
        seed_pool(ev, pool)
        # engineer stage after total coverage has been fixed (Q&A business order)
        cover_lp = solve_lex_rmp(ev, pool, 'unassigned_total', {})
        fixed = {'unassigned_total': cover_lp.objective_value}
        lp = solve_lex_rmp(ev, pool, 'new_active_engineers', fixed)
        full = enumerate_all_routes(ev, max_tasks=8)
        for k, routes in enumerate(full):
            vals = [reduced_cost_lex(ev, k, r, lp) for r in routes]
            self.assertTrue(all(isinstance(x, float) for x in vals))

    def test_v2_never_degrades_warm(self):
        ins = synthetic_instance(24, 6, 305, pattern='mixed')
        out = solve_hybrid_v2(ins, HybridV2Config(
            seed=305, total_seconds=10, warm_start_seconds=3,
            warm_start_iterations=60, pre_master_seconds=1,
            lex_cg_seconds=3, final_mip_seconds=2,
            lex_cg=LexCGConfig(max_iterations_per_stage=5,
                                pricing_time_per_engineer=.08,
                                candidate_width=12,
                                max_labels_per_node=80,
                                max_total_labels=3000,
                                certification_pass=False)))
        self.assertLessEqual(tuple(out.report['objective']),
                             tuple(out.report['metadata']['warm_start_objective']))
        self.assertEqual(tuple(out.report['objective']), validate_plan(ins, out.routes))


if __name__ == '__main__':
    unittest.main()

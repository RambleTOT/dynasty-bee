import unittest
import numpy as np

from dispatch.demo import synthetic_instance
from dispatch.evaluate import Evaluator
from dispatch.column_generation import (solve_rmp, seed_pool, price_engineer,
                                        reduced_cost_of_route, column_generate, CGConfig)
from dispatch.master import enumerate_all_routes, recombine
from dispatch.search import solve, SearchConfig
from dispatch.hybrid import solve_hybrid, HybridConfig
from dispatch.validation import validate_plan


class TestColumnGeneration(unittest.TestCase):
    def test_pricing_matches_complete_route_enumeration(self):
        for seed in [31, 32, 33]:
            ins = synthetic_instance(6, 2, seed, pattern='tight')
            ev = Evaluator(ins)
            pool = [set() for _ in ins.engineers]
            seed_pool(ev, pool)
            lp = solve_rmp(ev, pool)
            all_routes = enumerate_all_routes(ev, max_tasks=8)
            for k in range(len(ins.engineers)):
                brute = []
                for r in all_routes[k]:
                    brute.append((reduced_cost_of_route(ev, k, r, lp), r))
                brute.sort()
                pr = price_engineer(ev, k, lp.task_duals, lp.engineer_duals[k],
                                    seconds=20, max_columns=50, candidate_width=None,
                                    max_labels_per_node=None, max_total_labels=None)
                self.assertTrue(pr.completed)
                brute_neg = [(rc, r) for rc, r in brute if rc < -1e-7]
                if brute_neg:
                    self.assertTrue(pr.routes)
                    self.assertAlmostEqual(pr.routes[0][0], brute_neg[0][0], places=7)
                else:
                    self.assertEqual(pr.routes, [])

    def test_cg_pool_reaches_complete_pool_integer_optimum_small(self):
        for seed in [41, 42, 43]:
            ins = synthetic_instance(6, 2, seed, pattern='mixed')
            ev = Evaluator(ins)
            warm = solve(ins, SearchConfig(seed=seed, iterations=0, restarts=1,
                                           time_limit_seconds=1, master_seconds=0,
                                           use_master=False, buffer_restarts=()))
            pool = [set(x) for x in warm.pool]
            cg = column_generate(ev, pool, CGConfig(max_iterations=50, time_limit_seconds=20,
                                                    pricing_time_per_engineer=5,
                                                    candidate_width=None,
                                                    max_labels_per_node=None,
                                                    max_total_labels=None,
                                                    certification_pass=False), warm.routes)
            got, _ = recombine(ev, cg.pool, warm.routes, seconds=5)

            complete = enumerate_all_routes(ev, max_tasks=8)
            exact, meta = recombine(ev, complete, warm.routes, seconds=10, complete_pool=True)
            self.assertTrue(meta['global_optimal'])
            self.assertEqual(validate_plan(ins, got), validate_plan(ins, exact))

    def test_hybrid_never_degrades_warm_start(self):
        ins = synthetic_instance(24, 6, 77, pattern='mixed')
        warm = solve(ins, SearchConfig(seed=77, iterations=80, restarts=3,
                                       time_limit_seconds=4, master_seconds=0,
                                       use_master=False, buffer_restarts=()))
        hy = solve_hybrid(ins, HybridConfig(seed=77, total_seconds=12,
                                            warm_start_seconds=4,
                                            warm_start_iterations=80,
                                            pre_master_seconds=1,
                                            cg_seconds=4,
                                            final_mip_seconds=3,
                                            cg=CGConfig(max_iterations=8,
                                                        pricing_time_per_engineer=.2,
                                                        certification_pass=False,
                                                        candidate_width=16,
                                                        max_labels_per_node=150,
                                                        max_total_labels=10000)))
        self.assertLessEqual(tuple(hy.report['objective']), tuple(hy.report['metadata']['warm_start_objective']))
        self.assertEqual(tuple(hy.report['objective']), validate_plan(ins, hy.routes))


if __name__ == '__main__':
    unittest.main()

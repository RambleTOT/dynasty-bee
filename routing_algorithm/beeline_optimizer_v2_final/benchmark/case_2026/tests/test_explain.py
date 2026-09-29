import unittest
from dispatch import solve,SearchConfig
from dispatch.demo import synthetic_instance
from dispatch.explain import explain_task
class TestExplain(unittest.TestCase):
    def test_grounded_single_task_explanation(self):
        ins=synthetic_instance(5,2,44)
        result=solve(ins,SearchConfig(iterations=2,restarts=1,time_limit_seconds=1,master_seconds=.1))
        assigned=next((i for r in result.routes for i in r),None)
        if assigned is None:self.fail('Synthetic fixture unexpectedly has no assignments')
        e=explain_task(ins,result.routes,ins.tasks[assigned].id)
        self.assertEqual(e['task_id'],ins.tasks[assigned].id)
        self.assertIn(e['required_skill'],e['engineer_skills'])
        self.assertIn('not a global',e['counterfactual_scope'])
    def test_unknown_task_rejected(self):
        ins=synthetic_instance(2,2,1)
        with self.assertRaises(ValueError):explain_task(ins,[(),()],'unknown')
if __name__=='__main__':unittest.main()

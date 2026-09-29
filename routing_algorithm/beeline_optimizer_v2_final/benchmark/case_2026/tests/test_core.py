from dataclasses import replace
import itertools
import json
import random
import unittest
import numpy as np
from dispatch import Instance, Task, Engineer, Evaluator, baseline, solve, SearchConfig
from dispatch.demo import synthetic_instance
from dispatch.validation import validate_plan
from dispatch.master import enumerate_all_routes, recombine
from dispatch.bounds import personnel_lower_bound
from dispatch.replan import EngineerState, residual_problem, replan
from dispatch.risk import synthetic_scenarios, evaluate_risk, risk_recombine, cvar


def tiny(tasks, engineers=None, time=None):
    engineers=engineers or [Engineer('E',0,540,1080,('local',),'car')]
    size=max([e.start_node for e in engineers]+[t.node for t in tasks]+[0])+1
    mat=np.zeros((size,size),dtype=np.int64) if time is None else np.asarray(time,dtype=np.int64)
    modes={e.transport for e in engineers}
    return Instance(tasks,engineers,{m:mat.copy() for m in modes},{m:mat.copy()*100 for m in modes})


class TestCore(unittest.TestCase):
    def test_window_is_start_not_completion(self):
        x=tiny([Task('T',1,60,600,600,'local')])
        self.assertTrue(Evaluator(x).route(0,(0,))[0])
        self.assertEqual(Evaluator(x).schedule(0,(0,))[0]['end_minute'],660)

    def test_final_service_must_fit_shift(self):
        x=tiny([Task('T',1,481,600,600,'local')])
        self.assertFalse(Evaluator(x).route(0,(0,))[0])

    def test_exact_shift_end_allowed(self):
        x=tiny([Task('T',1,480,600,600,'local')])
        self.assertTrue(Evaluator(x).route(0,(0,))[0])

    def test_waiting(self):
        x=tiny([Task('T',1,30,600,660,'local')],time=[[0,10],[10,0]])
        row=Evaluator(x).schedule(0,(0,))[0]
        self.assertEqual((row['arrival_minute'],row['start_minute'],row['waiting_minutes']),(550,600,50))

    def test_open_route_no_return(self):
        x=tiny([Task('T',1,10,540,570,'local')],time=[[0,10],[9999,0]])
        self.assertEqual(validate_plan(x,[(0,)])[4],1000)

    def test_missing_skill(self):
        x=tiny([Task('T',1,10,540,900,'emergency')])
        self.assertEqual(baseline(x),[()])
        self.assertEqual(Evaluator(x).report([()])['unassigned'][0]['code'],'NO_SKILL')

    def test_transport(self):
        e=Engineer('E',0,540,1080,('local',),'walk')
        x=tiny([Task('T',1,10,540,900,'local','car')],[e])
        self.assertEqual(baseline(x),[()])

    def test_release_time(self):
        x=tiny([Task('T',1,10,540,900,'local',release_time=800)])
        self.assertEqual(Evaluator(x).schedule(0,(0,))[0]['start_minute'],800)

    def test_release_after_window(self):
        x=tiny([Task('T',1,10,540,700,'local',release_time=800)])
        self.assertEqual(baseline(x),[()])

    def test_no_double_assignment(self):
        x=tiny([Task('T',1,10,540,900,'local')])
        with self.assertRaises(ValueError): validate_plan(x,[(0,0)])

    def test_negative_task_index(self):
        x=tiny([Task('T',1,10,540,900,'local')])
        with self.assertRaises(ValueError): Evaluator(x).key([(-1,)])

    def test_invalid_matrix_not_silently_rounded(self):
        x=tiny([Task('T',1,10,540,900,'local')]).to_dict()
        x['travel_minutes']['car'][0][1]=.5
        with self.assertRaises(ValueError): Instance.from_dict(x)

    def test_duplicate_id(self):
        x=tiny([Task('T',1,10,540,900,'local'),Task('T',2,10,540,900,'local')])
        with self.assertRaises(ValueError): x.validate()

    def test_engineer_specific_duration(self):
        x=tiny([Task('T',1,10,1000,1060,'local')])
        x.service_by_engineer=np.array([[100]])
        self.assertFalse(Evaluator(x).route(0,(0,))[0])

    def test_empty(self):
        r=solve(tiny([]),SearchConfig(iterations=0,restarts=1,time_limit_seconds=2,master_seconds=1))
        self.assertEqual(r.report['objective'],[0,0,0,0,0,0])

    def test_unavailable(self):
        e=replace(Engineer('E',0,540,1080,('local',),'car'),available=False,used_today=True)
        x=tiny([Task('T',1,10,540,900,'local')],[e])
        self.assertEqual(validate_plan(x,baseline(x))[:4],(0,0,1,1))

    def test_urgent_priority(self):
        x=tiny([Task('normal',1,100,600,600,'local'),Task('urgent',2,100,600,600,'local',urgent=True)])
        r=solve(x,SearchConfig(iterations=5,restarts=2,time_limit_seconds=4,master_seconds=1,exact_small=True))
        self.assertEqual(r.report['unassigned_urgent'],0)
        self.assertEqual(r.routes,[(1,)])

    def test_urgent_precedes_total_coverage(self):
        # One engineer can either do a long urgent task OR two normal tasks. Final business
        # order says urgent first, so the urgent task must win even though fewer jobs are served.
        tasks=[Task('urgent',1,120,540,540,'local',urgent=True),
               Task('n1',2,10,540,900,'local'), Task('n2',3,10,540,900,'local')]
        # travel makes urgent mutually exclusive with both normals; normals are co-located.
        time=[[0,0,0,0],[0,0,999,999],[0,999,0,0],[0,999,0,0]]
        e=Engineer('E',0,540,660,('local',),'car')
        x=tiny(tasks,[e],time=time)
        r=solve(x,SearchConfig(iterations=2,restarts=1,time_limit_seconds=5,master_seconds=2,exact_small=True))
        self.assertEqual(r.report['planned_count'],1)
        self.assertEqual(r.report['unassigned_urgent'],0)

    def test_validator_checks_skill_level_and_tools(self):
        e=Engineer('E',0,540,1080,('local',),'car',skill_levels=(('local',1),),tools=('basic',))
        x=tiny([Task('T',1,10,540,900,'local',min_skill_level=2,required_tools=('meter',))],[e])
        with self.assertRaises(ValueError): validate_plan(x,[(0,)])

    def test_locked_prefix(self):
        e=Engineer('E',0,540,1080,('local',),'car',locked_prefix=('B',))
        x=tiny([Task('A',1,10,540,900,'local'),Task('B',2,10,540,900,'local')],[e])
        r=solve(x,SearchConfig(iterations=10,restarts=2,time_limit_seconds=4,master_seconds=1))
        self.assertEqual(r.routes[0][0],1)
        validate_plan(x,r.routes)

    def test_invalid_locked_prefix_rejected(self):
        e=Engineer('E',0,540,1080,('local',),'car',locked_prefix=('B',))
        x=tiny([Task('B',1,10,100,200,'local')],[e])
        with self.assertRaises(ValueError): solve(x)

    def test_independent_validator_random_scenarios(self):
        for seed in range(8):
            x=synthetic_instance(24,6,seed,['mixed','spread','tight','clustered'][seed%4])
            r=solve(x,SearchConfig(seed=seed,iterations=20,restarts=2,time_limit_seconds=5,master_seconds=.7,buffer_restarts=()))
            self.assertEqual(tuple(r.report['objective']),validate_plan(x,r.routes))
            self.assertLessEqual(tuple(r.report['objective']),tuple(r.report['metadata']['baseline_objective']))

    def test_workforce_lower_bound(self):
        x=synthetic_instance(20,6,22)
        r=solve(x,SearchConfig(iterations=10,restarts=2,time_limit_seconds=5,master_seconds=1))
        b=personnel_lower_bound(x,r.routes,seconds=1)
        self.assertIsNotNone(b['lower_bound_engineers'])
        self.assertLessEqual(b['lower_bound_engineers'],r.report['active_engineers_today'])

    def test_exact_against_independent_brute_force(self):
        # Enumerate assignments AND every order; feasibility checked by independent code.
        for seed in [21,22,23]:
            x=synthetic_instance(5,2,seed)
            best=None
            for assignment in itertools.product(range(-1,2),repeat=5):
                buckets=[[i for i,k in enumerate(assignment) if k==owner] for owner in range(2)]
                for routes in itertools.product(*(itertools.permutations(b) for b in buckets)):
                    try: key=validate_plan(x,routes)
                    except ValueError: continue
                    if best is None or key<best: best=key
            r=solve(x,SearchConfig(iterations=2,restarts=1,time_limit_seconds=10,master_seconds=3,exact_small=True))
            self.assertEqual(tuple(r.report['objective']),best)
            self.assertTrue(r.report['metadata']['master']['global_optimal'])

    def test_replan_uses_actual_not_planned_completions(self):
        x=tiny([Task('T',1,10,540,900,'local')])
        previous=Evaluator(x).report([(0,)])
        state=[EngineerState('E',0,800,False)]
        residual,_=residual_problem(x,previous,800,state,set())
        self.assertEqual([t.id for t in residual.tasks],['T'])
        self.assertEqual(residual.engineers[0].shift_start,800)

    def test_replan_committed_job_not_rescheduled(self):
        x=tiny([Task('A',1,60,540,900,'local'),Task('B',2,10,540,900,'local')])
        previous=Evaluator(x).report([(0,1)])
        state=[EngineerState('E',1,650,True,committed_task_ids=('A',))]
        residual,r=replan(x,previous,600,state,set(),config=SearchConfig(iterations=5,restarts=1,time_limit_seconds=4,master_seconds=1))
        self.assertEqual([t.id for t in residual.tasks],['B'])
        self.assertGreaterEqual(r.report['routes'][0]['schedule'][0]['start_minute'],650)
        self.assertEqual(residual.metadata['actual_completed_ids'],[])

    def test_cancel_committed_rejected(self):
        x=tiny([Task('A',1,60,540,900,'local')])
        previous=Evaluator(x).report([(0,)])
        state=[EngineerState('E',1,650,True,committed_task_ids=('A',))]
        with self.assertRaises(ValueError): residual_problem(x,previous,600,state,set(),{'A'})

    def test_telemetry_required(self):
        x=tiny([])
        with self.assertRaises(ValueError): residual_problem(x,{'routes':[]},600,[],set())

    def test_cvar(self):
        self.assertAlmostEqual(cvar([0,1,2],.25),4/3)
        self.assertAlmostEqual(cvar([0,1,2],.95),2)
        self.assertAlmostEqual(cvar([0,1,2],0),1)

    def test_risk_preserves_coverage_and_distance_budget(self):
        x=synthetic_instance(20,6,13)
        r=solve(x,SearchConfig(iterations=25,restarts=2,time_limit_seconds=5,master_seconds=1))
        sc=synthetic_scenarios(x,32,567)
        new,meta=risk_recombine(x,r.pool,r.routes,sc,seconds=3,distance_tolerance=.05)
        key=validate_plan(x,new)
        self.assertEqual(key[:2],tuple(r.report['objective'])[:2])
        self.assertLessEqual(key[2],r.report['objective'][2])
        self.assertLessEqual(key[3],r.report['objective'][3]*1.05)
        self.assertIn('SYNTHETIC',evaluate_risk(x,new,sc)['scenario_origin'])

    def test_json_roundtrip(self):
        x=synthetic_instance(10,4,4)
        xx=Instance.from_dict(json.loads(json.dumps(x.to_dict())))
        self.assertEqual(validate_plan(x,baseline(x)),validate_plan(xx,baseline(xx)))


if __name__=='__main__': unittest.main()

import numpy as np
from dataclasses import replace
from dispatch.model import Task, Engineer, Instance
from dispatch.evaluate import Evaluator
from dispatch.production import ProductionConfig
from dispatch.operations import plan, baseline_fifo, check_constraints, handle_urgent, diff
from dispatch.contracts import instance_from_problem


def make_instance():
    tasks=[
        Task('A',1,40,600,660,'emergency',urgent=True,release_time=600,priority_rank=1,type_bk='Глобальная проблема'),
        Task('B',2,40,600,800,'installation',priority_rank=2,type_bk='Подключение'),
        Task('C',3,30,600,800,'local',priority_rank=3,type_bk='Локальная заявка'),
    ]
    eng=[Engineer('E1',0,600,900,('emergency','installation','local'),'car'),
         Engineer('E2',0,600,900,('installation','local'),'car')]
    m=np.array([[0,10,10,10],[10,0,10,10],[10,10,0,10],[10,10,10,0]],dtype=int)
    return Instance(tasks,eng,{'car':m},{'car':m*1000})


def test_priority_vector_and_plan_valid():
    ins=make_instance(); r=plan(ins,ProductionConfig(total_seconds=.5,warm_iterations=30,master_seconds=.1))
    assert r.report['objective'][:3] == [0,0,0]
    assert check_constraints(ins,r.routes)==[]


def test_fifo_uses_same_constraints():
    ins=make_instance(); out=baseline_fifo(ins)
    assert out['report']['violations']==[]


def test_problem_contract_adapter():
    p={'scenario_id':'s','region_id':'east','engineers':[{'id':'E','start_node':0,'shift_start':'10:00','shift_end':'22:00','skills':['emergency'],'transport':'car'}],
       'requests':[{'id':'R','node':1,'type_bk':'Глобальная проблема','required_skill':'emergency','duration_minutes':80,'window_start':'10:00','window_end':'22:00','release_time':'13:00','priority':'urgent'}],
       'travel':{'minutes':{'car':[[0,10],[10,0]]},'km':{'car':[[0,2.5],[2.5,0]]}}}
    ins=instance_from_problem(p)
    assert ins.tasks[0].priority_rank==1 and ins.tasks[0].release_time==780
    assert ins.distance_m['car'][0,1]==2500


def test_urgent_event_prefers_feasible_emergency_engineer():
    # Build morning plan without A, then updated instance with A released at 11:00.
    base=make_instance()
    morning=Instance(base.tasks[1:],base.engineers,base.travel_minutes,base.distance_m)
    pr=plan(morning,ProductionConfig(total_seconds=.4,warm_iterations=20,master_seconds=.1))
    # Map current report task ids B,C into updated instance; A is new.
    updated=make_instance()
    rep=handle_urgent(updated,pr.report,'A',event_time=660)
    assert rep['decision']['engineer_id']=='E1'
    assert rep['violations']==[]
    assert rep['decision']['reaction_minutes']>=0


def test_contract_rejects_cross_section_engineer():
    from dispatch.contracts import instance_from_problem
    import pytest
    problem = {
        'section_id': 'east',
        'engineers': [{'id':'E1','start_node':0,'shift_start':'10:00','shift_end':'22:00',
                       'skills':['local'],'transport':'walk','available':True,'section_id':'other'}],
        'requests': [{'id':'R1','node':1,'duration_minutes':30,'window_start':'10:00','window_end':'12:00',
                      'required_skill':'local','priority_rank':3,'section_id':'east'}],
        'travel': {'minutes': {'walk': [[0,10],[10,0]]}, 'km': {'walk': [[0,1],[1,0]]}},
    }
    with pytest.raises(ValueError, match='another section'):
        instance_from_problem(problem)


def test_addon_uses_installation_skill_but_rank3_priority():
    from dispatch.contracts import instance_from_problem
    problem = {
        'section_id': 'east',
        'engineers': [{'id':'E1','start_node':0,'shift_start':'10:00','shift_end':'22:00',
                       'skills':['installation'],'transport':'walk','available':True,'section_id':'east'}],
        'requests': [{'id':'R1','node':1,'duration_minutes':20,'window_start':'10:00','window_end':'12:00',
                      'type_bk':'Дозаказ','section_id':'east'}],
        'travel': {'minutes': {'walk': [[0,10],[10,0]]}, 'km': {'walk': [[0,1],[1,0]]}},
    }
    ins = instance_from_problem(problem)
    assert ins.tasks[0].skill == 'installation'
    assert ins.tasks[0].priority_rank == 3


def test_contract_derives_locked_prefix_from_live_plan():
    from dispatch.contracts import instance_from_problem
    problem = {
        'section_id':'east',
        'engineers':[{'id':'E1','start_node':0,'shift_start':'10:00','shift_end':'22:00','skills':['local'],'transport':'walk','section_id':'east'}],
        'requests':[
            {'id':'R1','node':1,'duration_minutes':30,'window_start':'10:00','window_end':'12:00','required_skill':'local','priority_rank':3,'section_id':'east'},
            {'id':'R2','node':2,'duration_minutes':30,'window_start':'12:00','window_end':'14:00','required_skill':'local','priority_rank':3,'section_id':'east'}],
        'travel': {'minutes': {'walk': [[0,10,20],[10,0,10],[20,10,0]]}, 'km': {'walk': [[0,1,2],[1,0,1],[2,1,0]]}},
        'current_plan': {'routes':[{'engineer_id':'E1','visits':[{'request_id':'R1','status':'en_route','frozen':True},{'request_id':'R2','status':'planned'}]}]},
    }
    ins=instance_from_problem(problem)
    assert ins.engineers[0].locked_prefix == ('R1',)
    assert ins.engineers[0].used_today is True

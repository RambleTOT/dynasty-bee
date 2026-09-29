import numpy as np
from dataclasses import replace
from dispatch.model import Task, Engineer, Instance
from dispatch.operations import (plan, baseline_fifo, handle_cancel, handle_engineer_unavailable,
    handle_transport_changed, validate_move, check_slots, suggest, diff)
from dispatch.production import ProductionConfig


def base():
    tasks=[
      Task('A',1,60,600,720,'emergency',transport='car',urgent=True,priority_rank=1,zone='moscow'),
      Task('B',2,70,600,780,'installation',priority_rank=2,zone='moscow'),
      Task('C',3,30,720,900,'local',priority_rank=3,zone='moscow'),
      Task('D',4,20,780,960,'installation',priority_rank=3,zone='moscow'),
    ]
    eng=[Engineer('E1',0,600,1080,('emergency','installation','local'),'car'),
         Engineer('E2',0,600,1080,('installation','local'),'walk')]
    m=np.array([[0,10,12,18,20],[10,0,8,10,15],[12,8,0,8,10],[18,10,8,0,6],[20,15,10,6,0]])
    return Instance(tasks,eng,{'car':m,'walk':m*2},{'car':m*1000,'walk':m*1000})

def cfg(seed=42): return ProductionConfig(seed=seed,total_seconds=.35,warm_iterations=35,master_seconds=.1)

def test_transport_hard_constraint():
    ins=base(); r=plan(ins,cfg()); owner=next(x['engineer_id'] for x in r.report['routes'] if 'A' in x['task_ids']); assert owner=='E1'

def test_no_emergency_skill_leaves_accident_unassigned():
    ins=base(); eng=[replace(e,skills=tuple(s for s in e.skills if s!='emergency')) for e in ins.engineers]
    x=Instance(ins.tasks,eng,ins.travel_minutes,ins.distance_m); r=plan(x,cfg()); assert r.report['unassigned_rank1']==1

def test_deterministic_same_seed():
    ins=base(); a=plan(ins,cfg(9)); b=plan(ins,cfg(9)); assert a.report['objective']==b.report['objective'] and a.routes==b.routes

def test_cancel_removes_request_from_updated_instance():
    ins=base(); old=plan(ins,cfg()).report
    newtasks=[t for t in ins.tasks if t.id!='C']; upd=Instance(newtasks,ins.engineers,ins.travel_minutes,ins.distance_m)
    rep=handle_cancel(upd,old,'C'); assert all('C' not in r['task_ids'] for r in rep['routes'])

def test_engineer_unavailable_reassigns_or_reports_unassigned():
    ins=base(); old=plan(ins,cfg()).report
    eng=[replace(e,available=False) if e.id=='E1' else e for e in ins.engineers]
    upd=Instance(ins.tasks,eng,ins.travel_minutes,ins.distance_m)
    rep=handle_engineer_unavailable(upd,old,'E1'); assert rep['violations']==[]

def test_transport_change_revalidates_route():
    ins=base(); old=plan(ins,cfg()).report
    eng=[replace(e,transport='walk') if e.id=='E1' else e for e in ins.engineers]
    upd=Instance(ins.tasks,eng,ins.travel_minutes,ins.distance_m)
    rep=handle_transport_changed(upd,old,'E1'); assert rep['violations']==[]

def test_manual_move_validation():
    ins=base(); old=plan(ins,cfg()).report
    out=validate_move(ins,old,'A','E2'); assert out['feasible'] is False

def test_check_slots_returns_all_windows():
    ins=base(); probe=Task('X',4,30,600,720,'local',priority_rank=3)
    out=check_slots(ins,probe,[(600,720),(720,840),(840,960)]); assert len(out)==3 and all('available' in x for x in out)

def test_suggest_is_priority_sorted():
    ins=base(); old=plan(ins,cfg()).report
    # Empty report lets suggestions test insertability without depending on what plan chose.
    empty={'routes':[{'engineer_id':e.id,'task_ids':[]} for e in ins.engineers],'unassigned':[]}
    out=suggest(ins,empty,'E1',['C','B']); assert [x['priority_rank'] for x in out]==sorted(x['priority_rank'] for x in out)

def test_diff_detects_reassignment():
    old={'routes':[{'engineer_id':'E1','task_ids':['A']}]}; new={'routes':[{'engineer_id':'E2','task_ids':['A']}]}
    d=diff(old,new); assert d['changes'][0]['kind']=='reassigned'


def test_unavailable_engineer_keeps_locked_current_visit():
    ins=base()
    eng=[replace(ins.engineers[0],locked_prefix=('A',)), ins.engineers[1]]
    locked_ins=Instance(ins.tasks,eng,ins.travel_minutes,ins.distance_m)
    old=plan(locked_ins,cfg()).report
    eng2=[replace(eng[0],available=False), eng[1]]
    upd=Instance(ins.tasks,eng2,ins.travel_minutes,ins.distance_m)
    rep=handle_engineer_unavailable(upd,old,'E1')
    owner=next(r for r in rep['routes'] if r['engineer_id']=='E1')
    assert owner['task_ids'] and owner['task_ids'][0]=='A'

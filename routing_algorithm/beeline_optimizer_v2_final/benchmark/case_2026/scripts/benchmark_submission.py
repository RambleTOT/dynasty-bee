#!/usr/bin/env python3
from __future__ import annotations
import argparse, json, time, statistics
from dataclasses import replace
from pathlib import Path
import pandas as pd

from dispatch.beeline_benchmark_v3 import available_regions, from_case_region
from dispatch.demo import synthetic_instance
from dispatch.model import Instance, Task
from dispatch.operations import plan, baseline_fifo, handle_urgent
from dispatch.production import ProductionConfig
from dispatch.search import solve, SearchConfig
from dispatch.ml_risk import OperationalRiskBundle
from dispatch.ml_integration import solve_with_ml, MLEnhancementConfig


def pair_features(ins: Instance):
    rows=[]
    for k,e in enumerate(ins.engineers):
        levels=dict(e.skill_levels)
        for t in ins.tasks:
            rows.append({
                'engineer_id':e.id,'request_id':t.id,'required_skill':t.skill,
                'type_bk':t.type_bk or {'emergency':'Глобальная проблема','installation':'Подключение','local':'Локальная заявка'}[t.skill],
                'type_hd':t.type_hd or ('Авария' if t.skill=='emergency' else 'Ремонт'),
                'transport':e.transport,'zone':t.zone or 'moscow','technology':'FTTB','gigabit':'no',
                'hour':t.window_start//60,'weekday':0,'skill_level':levels.get(t.skill,1 if t.skill in e.skills else 0),
                'engineer_experience':float(2+(k%7)),'normative_duration':t.duration,
            })
    return pd.DataFrame(rows)


def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--case-root',required=True); ap.add_argument('--out',required=True); ap.add_argument('--model-dir',default=None,help='OperationalRiskBundle folder; defaults to models/demo_synthetic'); args=ap.parse_args()
    out=Path(args.out); out.mkdir(parents=True,exist_ok=True)
    case=[]
    for region in available_regions(args.case_root):
        for seed in (1,2,3):
            ins=from_case_region(args.case_root,region,seed)
            b=baseline_fifo(ins)['report']
            t0=time.perf_counter(); r=plan(ins,ProductionConfig(seed=seed,total_seconds=2.5,warm_iterations=420,master_seconds=.7)); sec=time.perf_counter()-t0
            case.append({'region':region,'seed':seed,'n':len(ins.tasks),'k':len(ins.engineers),
                         'baseline_objective':b['objective'],'ours_objective':r.report['objective'],
                         'baseline_planned':b['planned_count'],'ours_planned':r.report['planned_count'],
                         'baseline_km':b['future_distance_km'],'ours_km':r.report['future_distance_km'],
                         'seconds':sec,'violations':len(r.report['violations'])})
    # Exact-small: full route enumeration gives the true optimum for this supplied model.
    exact=[]
    for seed in range(1001,1021):
        ins=synthetic_instance(6,3,seed,'mixed')
        optimum=solve(ins,SearchConfig(seed=seed,iterations=0,restarts=1,time_limit_seconds=3.2,master_seconds=2.8,exact_small=True,buffer_restarts=()))
        prod=plan(ins,ProductionConfig(seed=seed,total_seconds=1.2,warm_iterations=300,master_seconds=.3))
        exact.append({'seed':seed,'optimum':optimum.report['objective'],'ours':prod.report['objective'],
                      'match':prod.report['objective']==optimum.report['objective']})
    # Emergency event behaviour.
    urgent=[]
    for seed in range(2001,2021):
        full=synthetic_instance(12,4,seed,'mixed')
        event=13*60
        # Re-purpose task 0 as a newly arrived emergency; keep matrices/nodes unchanged.
        u=replace(full.tasks[0],duration=80,window_start=event,window_end=18*60,
                  skill='emergency',transport=None,urgent=True,release_time=event,priority_rank=1,
                  type_bk='Глобальная проблема',type_hd='Авария')
        updated=Instance([u]+full.tasks[1:],full.engineers,full.travel_minutes,full.distance_m,metadata=full.metadata)
        morning=Instance(full.tasks[1:],full.engineers,full.travel_minutes,full.distance_m,metadata=full.metadata)
        pr=plan(morning,ProductionConfig(seed=seed,total_seconds=.45,warm_iterations=45,master_seconds=.12))
        t0=time.perf_counter(); rep=handle_urgent(updated,pr.report,u.id,event); sec=time.perf_counter()-t0
        urgent.append({'seed':seed,'assigned':rep.get('decision') is not None,'seconds':sec,
                       'reaction_minutes':None if rep.get('decision') is None else rep['decision']['reaction_minutes'],
                       'violations':len(rep.get('violations',[]))})
    # ML demo on one seed per case region; metrics are synthetic-demo only.
    ml=[]
    bundle_path=Path(args.model_dir).resolve() if args.model_dir else Path(__file__).resolve().parents[1]/'models/demo_synthetic'
    if bundle_path.exists():
        bundle=OperationalRiskBundle.load(bundle_path)
        for region in available_regions(args.case_root):
            ins=from_case_region(args.case_root,region,1)
            feat=pair_features(ins)
            res=solve_with_ml(ins,feat,bundle,ProductionConfig(seed=7,total_seconds=2.0,warm_iterations=320,master_seconds=.6),
                              MLEnhancementConfig(service_quantile='normative',rerank_by_risk=True,max_distance_increase=.03,mip_seconds=.8,max_routes_per_engineer=70))
            meta=res.report.get('ml',{}).get('rerank') or {}
            rb, ra = meta.get('risk_before'), meta.get('risk_after')
            ml.append({'region':region,'accepted':bool(meta.get('accepted',False)),
                       'risk_before':rb,'risk_after':ra,
                       'risk_reduction_pct':None if rb in (None,0) or ra is None else 100.0*(rb-ra)/rb,
                       'urgent_delay_before':meta.get('urgent_delay_before'),
                       'urgent_delay_after':meta.get('urgent_delay_after'),
                       'objective':res.report['objective']})
    # aggregate
    summary={
      'case_runs':len(case),
      'case_total_requests':sum(x['n'] for x in case),
      'baseline_unassigned_by_rank':[sum(x['baseline_objective'][j] for x in case) for j in range(3)],
      'ours_unassigned_by_rank':[sum(x['ours_objective'][j] for x in case) for j in range(3)],
      'baseline_total_planned':sum(x['baseline_planned'] for x in case),'ours_total_planned':sum(x['ours_planned'] for x in case),
      'baseline_median_engineers':statistics.median(x['baseline_objective'][3] for x in case),
      'ours_median_engineers':statistics.median(x['ours_objective'][3] for x in case),
      'baseline_median_km':statistics.median(x['baseline_km'] for x in case),'ours_median_km':statistics.median(x['ours_km'] for x in case),
      'ours_median_seconds':statistics.median(x['seconds'] for x in case),'ours_max_seconds':max(x['seconds'] for x in case),
      'hard_violations':sum(x['violations'] for x in case),
      'exact_small_matches':sum(x['match'] for x in exact),'exact_small_total':len(exact),
      'urgent_assigned':sum(x['assigned'] for x in urgent),'urgent_total':len(urgent),
      'urgent_median_handler_seconds':statistics.median(x['seconds'] for x in urgent),
      'ml_regions':len(ml),'ml_rerank_accepted':sum(x['accepted'] for x in ml),
      'ml_mean_risk_reduction_pct':(statistics.mean(x['risk_reduction_pct'] for x in ml if x['risk_reduction_pct'] is not None)
                                    if any(x['risk_reduction_pct'] is not None for x in ml) else None),
      'ml_urgent_response_nonworsening':all((x['urgent_delay_after'] is None or x['urgent_delay_before'] is None or
                                             x['urgent_delay_after'] <= x['urgent_delay_before'] + 1e-9) for x in ml),
    }
    for name,data in [('case.json',case),('exact_small.json',exact),('urgent_events.json',urgent),('ml_rerank.json',ml),('summary.json',summary)]:
        (out/name).write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps(summary,ensure_ascii=False,indent=2))

if __name__=='__main__': main()

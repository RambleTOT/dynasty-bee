#!/usr/bin/env python3
from __future__ import annotations
import argparse, json, math
from pathlib import Path


def compare(a,b,path='root',tol=1e-12,errors=None):
    if errors is None: errors=[]
    if isinstance(a,dict) and isinstance(b,dict):
        if set(a)!=set(b): errors.append(f'{path}: keys differ {set(a)^set(b)}')
        for k in sorted(set(a)&set(b)): compare(a[k],b[k],f'{path}.{k}',tol,errors)
    elif isinstance(a,list) and isinstance(b,list):
        if len(a)!=len(b): errors.append(f'{path}: len {len(a)} != {len(b)}')
        for i,(x,y) in enumerate(zip(a,b)): compare(x,y,f'{path}[{i}]',tol,errors)
    elif isinstance(a,(int,float)) and isinstance(b,(int,float)):
        if math.isnan(a) and math.isnan(b): return errors
        if not math.isclose(float(a),float(b),rel_tol=tol,abs_tol=tol): errors.append(f'{path}: {a} != {b}')
    else:
        if a!=b: errors.append(f'{path}: {a!r} != {b!r}')
    return errors


def compare_ml(a,b,strict=False):
    """Allow small cross-platform CatBoost drift; all counts and settings stay exact."""
    limits={'p50_mae_minutes':1.0,'p90_coverage':0.02,
            'roc_auc':0.02,'brier':0.01,'ece':0.01}
    errors=[]
    def visit(x,y,path):
        if isinstance(x,dict) and isinstance(y,dict):
            if set(x)!=set(y): errors.append(f'{path}: keys differ {set(x)^set(y)}')
            for key in sorted(set(x)&set(y)): visit(x[key],y[key],f'{path}.{key}')
        elif isinstance(x,(int,float)) and isinstance(y,(int,float)):
            tolerance=1e-12 if strict else limits.get(path.rsplit('.',1)[-1],1e-12)
            if not math.isclose(float(x),float(y),rel_tol=0,abs_tol=tolerance):
                errors.append(f'{path}: {x} != {y} (allowed ±{tolerance})')
        elif x!=y:
            errors.append(f'{path}: {x!r} != {y!r}')
    visit(a,b,'ml_metrics')
    return errors


def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--root',default='.'); ap.add_argument('--full',action='store_true'); ap.add_argument('--strict-ml',action='store_true'); args=ap.parse_args()
    root=Path(args.root).resolve()
    expected=json.loads((root/'EXPECTED_METRICS.json').read_text(encoding='utf8'))
    rebuilt=json.loads((root/'reports/rebuilt/PUBLISHED_METRICS.json').read_text(encoding='utf8'))
    errors=compare(expected,rebuilt)

    # Dispatcher replay should be byte-for-byte equivalent after JSON parsing.
    disp_ref=json.loads((root/'reports/reference/dispatcher_evaluation_row_order.json').read_text(encoding='utf8'))
    disp_new=json.loads((root/'reports/reproduced/dispatcher_evaluation_row_order.json').read_text(encoding='utf8'))
    if disp_ref != disp_new:
        errors.append('dispatcher evaluation differs from reference')

    # Freshly retrained ML model must reproduce the test metrics in the pinned environment.
    ml_ref=json.loads((root/'reports/reference/ml_model_metadata.json').read_text(encoding='utf8'))['metrics']
    ml_new=json.loads((root/'reports/reproduced_model/metadata.json').read_text(encoding='utf8'))['metrics']
    errors += compare_ml(ml_ref,ml_new,args.strict_ml)

    if args.full:
        reference=json.loads((root/'reports/reference/case.json').read_text(encoding='utf8'))
        rerun=json.loads((root/'reports/reproduced/full_solver/case.json').read_text(encoding='utf8'))
        if len(reference)!=len(rerun):
            errors.append(f'solver run count: {len(rerun)} != {len(reference)}')
        for a,b in zip(reference,rerun):
            label=f"{a['region']} seed={a['seed']}"
            for key in ('region','seed','n','k','baseline_objective','baseline_planned'):
                if a[key]!=b[key]: errors.append(f'{label}: {key} differs')
            # The solver is time-limited. Lower-priority distance and soft penalty
            # can vary with CPU speed, but coverage and crew count must agree.
            if a['ours_objective'][:4]!=b['ours_objective'][:4]:
                errors.append(f'{label}: coverage/crew objective differs')
            if b['violations']!=0: errors.append(f'{label}: hard constraint violation')

        small=json.loads((root/'reports/reproduced/full_solver/exact_small.json').read_text(encoding='utf8'))
        urgent=json.loads((root/'reports/reproduced/full_solver/urgent_events.json').read_text(encoding='utf8'))
        ml=json.loads((root/'reports/reproduced/full_solver/ml_rerank.json').read_text(encoding='utf8'))
        if len(small)!=20 or not all(x['match'] for x in small):
            errors.append('small exact cases are not 20/20')
        if len(urgent)!=20 or not all(x['assigned'] and x['violations']==0 for x in urgent):
            errors.append('urgent cases are not 20/20 feasible assignments')
        if len(ml)!=3 or not all(x['accepted'] and x['risk_reduction_pct'] is not None
                                  and x['risk_reduction_pct']>0 and
                                  (x['urgent_delay_before'] is None or x['urgent_delay_after'] is None
                                   or x['urgent_delay_after']<=x['urgent_delay_before']+1e-9) for x in ml):
            errors.append('synthetic ML rerank did not improve all three regions safely')

    if errors:
        print('REPRODUCTION FAILED')
        for e in errors[:100]: print(' -',e)
        raise SystemExit(1)
    print('REPRODUCTION OK')
    print('Exact published metrics rebuilt from raw reference outputs: OK')
    print('Historical dispatcher replay from control CSV + prepared inputs: OK')
    exact_ml=not compare_ml(ml_ref,ml_new,True)
    print('ML model retraining metrics from synthetic history:',
          'exact match' if exact_ml else 'within documented tolerance')
    if args.full:
        print('Full solver rerun: coverage, crew count, constraints and scenario checks OK')

if __name__=='__main__': main()

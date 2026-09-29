#!/usr/bin/env python3
"""Rebuild every headline metric from frozen raw result JSON files.

This is the *exact* path for reproducing numbers printed in the presentation.
It performs no optimization; it aggregates the raw outputs of the reference run.
Use `reproduce.sh` to rerun the solver and ML from raw input data.
"""
from __future__ import annotations
import argparse, json, statistics
from pathlib import Path


def pct_drop(before, after):
    return 100.0 * (before - after) / before


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--report-dir', default='reports/reference')
    ap.add_argument('--out', default='reports/rebuilt/PUBLISHED_METRICS.json')
    args=ap.parse_args()
    root=Path(__file__).resolve().parents[1]
    rd=(root/args.report_dir) if not Path(args.report_dir).is_absolute() else Path(args.report_dir)
    case=json.loads((rd/'case.json').read_text(encoding='utf8'))
    exact=json.loads((rd/'exact_small.json').read_text(encoding='utf8'))
    urgent=json.loads((rd/'urgent_events.json').read_text(encoding='utf8'))
    mlrerank=json.loads((rd/'ml_rerank.json').read_text(encoding='utf8'))
    mlmeta=json.loads((rd/'ml_model_metadata.json').read_text(encoding='utf8'))
    dispatcher=json.loads((rd/'dispatcher_evaluation_row_order.json').read_text(encoding='utf8'))

    base_un=[sum(x['baseline_objective'][:3]) for x in case]
    ours_un=[sum(x['ours_objective'][:3]) for x in case]
    base_eng=statistics.median(x['baseline_objective'][3] for x in case)
    ours_eng=statistics.median(x['ours_objective'][3] for x in case)
    base_km=statistics.median(x['baseline_km'] for x in case)
    ours_km=statistics.median(x['ours_km'] for x in case)
    total=sum(x['n'] for x in case)
    base_planned=sum(x['baseline_planned'] for x in case)
    ours_planned=sum(x['ours_planned'] for x in case)

    per_region={}
    for region in sorted({x['region'] for x in case}):
        rows=[x for x in case if x['region']==region]
        per_region[region]={
            'n': rows[0]['n'],
            'ours_engineers_median': statistics.median(x['ours_objective'][3] for x in rows),
            'fifo_engineers_median': statistics.median(x['baseline_objective'][3] for x in rows),
            'ours_km_median': statistics.median(x['ours_km'] for x in rows),
            'fifo_km_median': statistics.median(x['baseline_km'] for x in rows),
            'ours_unassigned_median': statistics.median(sum(x['ours_objective'][:3]) for x in rows),
            'fifo_unassigned_median': statistics.median(sum(x['baseline_objective'][:3]) for x in rows),
            'ours_planned_median': statistics.median(x['ours_planned'] for x in rows),
            'fifo_planned_median': statistics.median(x['baseline_planned'] for x in rows),
        }

    out={
      'solver': {
        'case_runs': len(case), 'case_total_requests': total,
        'baseline_planned': base_planned, 'ours_planned': ours_planned,
        'coverage_pct': 100.0*ours_planned/total,
        'baseline_unassigned_by_rank': [sum(x['baseline_objective'][j] for x in case) for j in range(3)],
        'ours_unassigned_by_rank': [sum(x['ours_objective'][j] for x in case) for j in range(3)],
        'baseline_unassigned_total': sum(base_un), 'ours_unassigned_total': sum(ours_un),
        'engineers_median_before': base_eng, 'engineers_median_after': ours_eng,
        'engineers_reduction_pct': pct_drop(base_eng,ours_eng),
        'km_median_before': base_km, 'km_median_after': ours_km,
        'median_km_difference_pct': pct_drop(base_km,ours_km),
        'unassigned_reduction_pct': pct_drop(sum(base_un),sum(ours_un)),
        'hard_violations': sum(x['violations'] for x in case),
        'exact_small_matches': sum(bool(x['match']) for x in exact), 'exact_small_total': len(exact),
        'urgent_assigned': sum(bool(x['assigned']) for x in urgent), 'urgent_total': len(urgent),
        'per_region': per_region,
      },
      'ml': {
        'origin': mlmeta.get('origin'),
        'metrics': mlmeta['metrics'],
        'rerank_regions': len(mlrerank),
        'rerank_accepted': sum(bool(x['accepted']) for x in mlrerank),
        'risk_reduction_pct_by_region': {x['region']: x['risk_reduction_pct'] for x in mlrerank},
        'mean_risk_reduction_pct': statistics.mean(x['risk_reduction_pct'] for x in mlrerank),
        'urgent_response_nonworsening': all(x.get('urgent_delay_after',0)<=x.get('urgent_delay_before',0)+1e-9 for x in mlrerank),
      },
      'dispatcher': {
        x['region']: {k:x[k] for k in ('requests','assigned_rows','unassigned_rows','engineers_used','km_total','travel_minutes','started_in_window','started_in_window_pct_assigned','violation_visits','violation_events','violation_breakdown','engineer_shifts_per_100_assigned')}
        for x in dispatcher
      },
      'notes': {
        'runtime_metrics': 'Wall-clock times are hardware-dependent and intentionally excluded from exact equality checks.',
        'case_design': '205 distinct source requests are evaluated in three generated scenarios: 615 request-runs across nine region-seed runs.',
        'distance_comparison': 'The ratio of median distances is descriptive only: FIFO completes fewer requests, so this is not a like-for-like mileage saving.',
        'ml_demo': 'ML accuracy and risk reduction are from the included SYNTHETIC demonstration history, not real Beeline telemetry.'
      }
    }
    dest=(root/args.out) if not Path(args.out).is_absolute() else Path(args.out)
    dest.parent.mkdir(parents=True,exist_ok=True)
    dest.write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps(out,ensure_ascii=False,indent=2))

if __name__=='__main__': main()

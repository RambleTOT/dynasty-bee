#!/usr/bin/env python3
"""Reproduce the historical-dispatcher evaluation used in the presentation.

Assumption requested by the team: within each brigade, the rows in the control CSV
are already in the actual visit order.  Historical assignment is *not* treated as
ground truth optimality.  We replay it with the same service durations, modal
travel matrices and synthetic engineer roster used by the project.
"""
from __future__ import annotations
import argparse, json
from collections import Counter, defaultdict
from pathlib import Path
import pandas as pd

from dispatch.model import Instance

REGION_TO_ID = {'Восток': 'east', 'Юго-восток': 'south_east', 'Югоцентр': 'south_centre'}


def read_control(case_root: Path, region: str) -> pd.DataFrame:
    p = next(case_root.glob(f'{region} Контрольное распределение*.csv'))
    df = pd.read_csv(p, encoding='utf-8', sep=';')
    df['_num'] = pd.to_numeric(df['Заявка'], errors='coerce')
    return df[df['_num'].notna() & df['Начало'].notna() & df['Окончание'].notna()].reset_index(drop=True)


def replay_region(prepared_root: Path, case_root: Path, region: str) -> dict:
    rid = REGION_TO_ID[region]
    ins = Instance.load(prepared_root / rid / 'instance.json')
    control = read_control(case_root, region)
    if len(control) != len(ins.tasks):
        raise RuntimeError(f'{region}: control rows {len(control)} != prepared tasks {len(ins.tasks)}')

    engineer_index = {e.id: k for k, e in enumerate(ins.engineers)}
    routes: dict[str, list[int]] = defaultdict(list)
    statuses = Counter()
    unassigned = 0
    unknown = set()
    for i, row in control.iterrows():
        statuses[str(row.get('Статус BK'))] += 1
        b = row.get('Бригада')
        if pd.isna(b) or not str(b).strip():
            unassigned += 1
            continue
        b = str(b)
        if b not in engineer_index:
            unknown.add(b)
            continue
        routes[b].append(i)

    km_total = 0.0
    travel_total = 0
    started_in_window = 0
    violation_visits = 0
    violation_events = 0
    breakdown = Counter()
    km_by_engineer = {}
    route_records = []

    for engineer_id in sorted(routes):
        task_indices = routes[engineer_id]
        k = engineer_index[engineer_id]
        e = ins.engineers[k]
        levels = dict(e.skill_levels)
        now = int(e.shift_start)
        prev = int(e.start_node)
        route_km = 0.0
        visits = []
        for seq, i in enumerate(task_indices, 1):
            t = ins.tasks[i]
            travel = int(ins.travel_minutes[e.transport][prev][t.node])
            metres = int(ins.distance_m[e.transport][prev][t.node])
            arrival = now + travel
            start = max(arrival, int(t.window_start), int(t.release_time))
            end = start + int(t.duration)
            codes = []
            if t.skill not in e.skills or levels.get(t.skill, 1) < t.min_skill_level:
                codes.append('NO_SKILL')
            if t.transport is not None and t.transport != e.transport:
                codes.append('NO_TRANSPORT')
            if start > t.window_end:
                codes.append('WINDOW')
            if end > e.shift_end:
                codes.append('SHIFT')

            if start <= t.window_end:
                started_in_window += 1
            if codes:
                violation_visits += 1
                violation_events += len(codes)
                breakdown.update(codes)

            leg_km = metres / 1000.0
            km_total += leg_km
            route_km += leg_km
            travel_total += travel
            visits.append({
                'idx': i, 'task_id': t.id, 'seq': seq,
                'arrival': arrival, 'start': start, 'end': end,
                'km': round(leg_km, 3), 'codes': codes,
            })
            now, prev = end, t.node

        km_by_engineer[engineer_id] = round(route_km, 3)
        route_records.append({'engineer_id': engineer_id, 'count': len(task_indices),
                              'km': round(route_km, 3), 'visits': visits})

    assigned = len(control) - unassigned
    return {
        'region': region,
        'requests': len(control),
        'assigned_rows': assigned,
        'unassigned_rows': unassigned,
        'engineers_used': len(routes),
        'km_total': round(km_total, 3),
        'travel_minutes': int(travel_total),
        'started_in_window': int(started_in_window),
        'started_in_window_pct_assigned': round(100.0 * started_in_window / assigned, 1),
        'violation_visits': int(violation_visits),
        'violation_events': int(violation_events),
        'violation_breakdown': dict(breakdown),
        'engineer_shifts_per_100_all': round(100.0 * len(routes) / len(control), 1),
        'engineer_shifts_per_100_assigned': round(100.0 * len(routes) / assigned, 1),
        'statuses': dict(statuses),
        'km_by_engineer': km_by_engineer,
        'unknown_engineers': sorted(unknown),
        'routes': route_records,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--project-root', default='.')
    ap.add_argument('--case-root', default='data/raw_case/beeline_case_csv')
    ap.add_argument('--prepared-root', default='reports/reproduced/prepared')
    ap.add_argument('--out', default='reports/reproduced/dispatcher_evaluation_row_order.json')
    args = ap.parse_args()
    project = Path(args.project_root).resolve()
    case_root = (project / args.case_root).resolve() if not Path(args.case_root).is_absolute() else Path(args.case_root)
    prepared_root = (project / args.prepared_root).resolve() if not Path(args.prepared_root).is_absolute() else Path(args.prepared_root)
    result = [replay_region(prepared_root, case_root, r) for r in ('Восток', 'Юго-восток', 'Югоцентр')]
    out = (project / args.out).resolve() if not Path(args.out).is_absolute() else Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf8')
    print(json.dumps([{k:v for k,v in x.items() if k not in ('routes','km_by_engineer')} for x in result], ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()

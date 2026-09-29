"""Q&A-aligned semi-synthetic benchmark from the supplied Beeline case CSVs.

Real from case: demand rows, BK/HD job types, time windows, districts/address strings,
historical crew *count*, and one office address per region.
Generated because absent: geometry, modal travel matrices, skills, transports, shifts.
Service durations use the supplied Normatives spreadsheet minus the fixed 20-min road
component, because road time is modelled separately by the travel matrix.
"""
from __future__ import annotations
from pathlib import Path
from dataclasses import replace
import hashlib, re
import numpy as np
import pandas as pd
from .model import Instance, Task, Engineer


def decode_name(name: str) -> str:
    return re.sub(r'#U([0-9A-Fa-f]{4})', lambda m: chr(int(m.group(1),16)), name)

def _stable_u64(text: str) -> int:
    return int.from_bytes(hashlib.sha256(text.encode('utf8')).digest()[:8], 'little')

def _find_pairs(root: str | Path):
    items=[]
    for p in Path(root).rglob('*.csv'):
        items.append((decode_name(p.name),p))
    regions={}
    for decoded,p in items:
        region=decoded.split(' Контрольное')[0].split(' Синтетические')[0].rstrip('.')
        if 'Контрольное' in decoded: regions.setdefault(region,{})['control']=p
        if 'Синтетические' in decoded: regions.setdefault(region,{})['synthetic']=p
    return {r:v for r,v in regions.items() if 'control' in v and 'synthetic' in v}

def available_regions(root: str | Path):
    return sorted(_find_pairs(root))

def _raw(path):
    return pd.read_csv(path, encoding='utf-8', sep=';')

def _valid_jobs(df):
    out=df.copy(); out['_num']=pd.to_numeric(out.get('Заявка'), errors='coerce')
    out=out[out['_num'].notna() & out['Начало'].notna() & out['Окончание'].notna()].copy()
    return out.reset_index(drop=True)

def _office_address(df):
    mask=df['Заявка'].astype(str).str.casefold().eq('адрес офиса')
    mask |= df['Заявка'].astype(str).str.casefold().eq('адрес офисa')
    if not mask.any():
        # tolerate capitalization and minor unicode oddities
        mask=df['Заявка'].astype(str).str.casefold().str.contains('адрес офис', na=False)
    if not mask.any(): return 'UNKNOWN_OFFICE'
    return str(df.loc[mask, 'Тип заявки BK'].iloc[0])

def _skill(row):
    bk=str(row.get('Тип заявки BK','')).strip().casefold()
    if 'глобаль' in bk:
        return 'emergency'
    if 'подключ' in bk or 'дозаказ' in bk:
        return 'installation'
    return 'local'

def _priority_rank(row):
    # Official priority is "Авария -> Подключение -> Ремонт / Дозаказ".
    # The last chat export did not resolve whether every BK "Глобальная проблема"
    # is an авария, so rank 1 is assigned only to an explicit HD авария.
    hd=str(row.get('Тип заявки HD','')).strip().casefold()
    bk=str(row.get('Тип заявки BK','')).strip().casefold()
    if 'авар' in hd:
        return 1
    if 'подключ' in bk:
        return 2
    return 3

def _duration(row):
    """Service component only; road is handled by the travel matrix."""
    bk=str(row.get('Тип заявки BK','')).strip().casefold()
    if 'глобаль' in bk:
        return 80
    if 'дозаказ' in bk:
        return 20
    if 'подключ' in bk:
        return 70
    if 'локаль' in bk:
        return 30
    raise ValueError(f'Unmapped BK type: {row.get("Тип заявки BK")}')

def _required_transport(row):
    hd=str(row.get('Тип заявки HD','')).strip().casefold()
    giga=str(row.get('Гигабитное подключение','')).strip().casefold()
    # Team modelling assumption: cable work, gigabit and an explicit авария
    # require a car.  "Глобальная проблема / Информация" is intentionally not
    # silently treated as an авария while that mapping remains unconfirmed.
    if 'кабел' in hd or giga in {'да','yes','1','true'} or 'авар' in hd:
        return 'car'
    return None

def _zone(row):
    district=str(row.get('Район','')).strip()
    low=district.casefold()
    for city in ('домодедово','кашир','ступино'):
        if city in low:
            return city
    return 'moscow'

def from_case_region(root: str | Path, region: str, seed: int = 1) -> Instance:
    pairs=_find_pairs(root)
    if region not in pairs: raise ValueError(region)
    raw_syn=_raw(pairs[region]['synthetic']); demand=_valid_jobs(raw_syn)
    control=_valid_jobs(_raw(pairs[region]['control']))
    office=_office_address(raw_syn)
    crews=sorted(map(str,control['Бригада'].dropna().unique())) if 'Бригада' in control else []
    if not crews: crews=[f'Engineer-{i+1}' for i in range(max(6,round(len(demand)/7)))]
    k,n=len(crews),len(demand)

    # Synthetic geometry keeps real district/address clustering but makes no geocoding claim.
    districts=sorted(set(map(str,demand['Район'].fillna('unknown'))))
    centers={}
    for d in districts:
        rg=np.random.default_rng((_stable_u64(region+'|district|'+d)+seed)%(2**32))
        centers[d]=rg.uniform([0,0],[20,16])
    task_xy=[]
    for _,row in demand.iterrows():
        d=str(row.get('Район','unknown'))
        rg=np.random.default_rng((_stable_u64(region+'|addr|'+str(row.get('Адрес','')))+seed)%(2**32))
        task_xy.append(centers[d]+rg.normal(0,.45,2))
    task_xy=np.asarray(task_xy)
    centroid=task_xy.mean(axis=0)
    org=np.random.default_rng((_stable_u64(region+'|office|'+office)+seed)%(2**32))
    office_xy=centroid+org.normal(0,1.5,2)
    xy=np.vstack([office_xy[None,:],task_xy])
    euclid=np.sqrt(((xy[:,None]-xy[None,:,:])**2).sum(axis=2))
    base_km=euclid*1.27

    # Offline planning uses average modal travel, as allowed in the Q&A.
    modes={'public_transport':(18.0,3.0,1.12),'walk':(4.8,0.0,1.00),'car':(28.0,1.5,1.00),'bike':(14.0,0.5,1.04)}
    travel={}; distance={}
    for mode,(speed,overhead,dist_factor) in modes.items():
        dm=np.ceil(base_km*dist_factor*1000).astype(np.int64)
        tm=np.ceil(base_km/speed*60 + (euclid>0)*overhead).astype(np.int64)
        np.fill_diagonal(dm,0); np.fill_diagonal(tm,0)
        travel[mode]=tm; distance[mode]=dm

    # Capabilities are generated independently of historical assignments, per Q&A.
    profiles=[('local','installation','emergency'),('local','installation'),
              ('installation','emergency'),('local','emergency'),('local',),('installation',)]
    transports=['public_transport','public_transport','walk','car','car','bike']
    engineers=[]
    for idx,c in enumerate(crews):
        skills=profiles[(idx+seed)%len(profiles)]
        transport=transports[(idx+2*seed)%len(transports)]
        # Shift duration is absent from the case files. Team assumption: 10:00-22:00;
        # one or two shorter shifts are kept to exercise the hard shift constraint.
        shift=(10*60,18*60) if idx in {0, max(0,k-1)} else (10*60,22*60)
        home_zone='moscow'
        engineers.append(Engineer(c,0,shift[0],shift[1],tuple(skills),transport,
                                  skill_levels=tuple((sk, 2 if idx%3 else 3) for sk in skills),
                                  site_id=region, home_zone=home_zone))

    # Dataset self-check required by ML_SPEC: every skill that appears on a
    # car-required request must have at least one available car engineer.  We keep
    # transport diversity and minimally enrich an already-car profile instead of
    # changing the request set or historical assignment.
    car_skills={_skill(row) for _,row in demand.iterrows() if _required_transport(row)=='car'}
    for skill in sorted(car_skills):
        if any(e.transport=='car' and skill in e.skills for e in engineers):
            continue
        candidates=[(idx,e) for idx,e in enumerate(engineers) if e.transport=='car']
        if not candidates:
            raise ValueError(f'No car engineer available to cover required skill {skill}')
        idx,e=min(candidates,key=lambda x:(len(x[1].skills),x[1].id))
        skills=tuple(sorted(set(e.skills)|(set([skill]))))
        levels=dict(e.skill_levels); levels.setdefault(skill,2)
        engineers[idx]=replace(e,skills=skills,skill_levels=tuple(sorted(levels.items())))

    tasks=[]
    for i,row in demand.iterrows():
        start=pd.to_datetime(row['Начало'],dayfirst=True,errors='raise')
        end=pd.to_datetime(row['Окончание'],dayfirst=True,errors='raise')
        rank=_priority_rank(row)
        tasks.append(Task(str(int(row['_num'])),1+i,_duration(row),
                          int(start.hour*60+start.minute),int(end.hour*60+end.minute),
                          _skill(row), transport=_required_transport(row), urgent=(rank==1),
                          priority_rank=rank, type_bk=str(row.get('Тип заявки BK','')),
                          type_hd=str(row.get('Тип заявки HD','')), zone=_zone(row)))
    assumed_global_info_ids=[]
    return Instance(tasks,engineers,travel,distance,metadata={
        'benchmark_type':'case_provided_QA_aligned_semi_synthetic',
        'region':region,'seed':seed,'office_address':office,'crew_count_reference':k,
        'real_fields':['BK/HD type','time window','district','address string','historical crew count','office address'],
        'official_service_minutes_without_travel':{'Подключение':70,'Дозаказ':20,'Локальная заявка':30,'Авария на ТКД':80},
        'assumed_global_information_service_minutes':None,
        'assumed_global_information_task_ids':assumed_global_info_ids,
        'generated_fields':['geometry','modal travel matrices','skills','transport','shifts','required_transport'],
        'assumptions':['one CSV equals one service site; cross-site assignment forbidden','Moscow/suburban zones inside a site may be mixed but repeated zone switching is softly discouraged','one brigade is one engineer','no return to office','client window constrains work start','fixed 20-minute normative road component excluded to avoid double counting','shift 10:00-22:00 is synthetic because no official shift answer was available in the export','required_transport rules are team modelling assumptions'],
        'coordinates_km':xy.tolist(),
    })

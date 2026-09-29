#!/usr/bin/env python3
"""Generate a synthetic historical table only for an end-to-end ML smoke test.

The file is deliberately labelled SYNTHETIC.  It must never be presented as Beeline
historical accuracy; real models require actual execution telemetry.
"""
from __future__ import annotations
import argparse
from pathlib import Path
import numpy as np
import pandas as pd


def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--rows',type=int,default=12000); ap.add_argument('--seed',type=int,default=42); ap.add_argument('--out',required=True)
    args=ap.parse_args(); rng=np.random.default_rng(args.seed); n=args.rows
    types=np.array(['Подключение','Глобальная проблема','Локальная заявка','Дозаказ'])
    probs=np.array([.40,.10,.40,.10]); bk=rng.choice(types,n,p=probs)
    skill=np.where(np.char.find(bk.astype(str),'Глоб')>=0,'emergency',np.where(np.isin(bk,['Подключение','Дозаказ']),'installation','local'))
    normative=np.select([bk=='Подключение',bk=='Глобальная проблема',bk=='Дозаказ'],[70,80,20],default=30).astype(float)
    engineers=np.array([f'E{i:02d}' for i in range(1,31)]); eid=rng.choice(engineers,n)
    skill_level=rng.choice([1,2,3],n,p=[.30,.50,.20]); exp=np.clip(rng.gamma(2.0,1.7,n),.1,12)
    transport=rng.choice(['car','walk','bike','public_transport'],n,p=[.28,.25,.07,.40])
    zone=rng.choice(['moscow','domodedovo','kashira','stupino'],n,p=[.78,.09,.07,.06])
    tech=rng.choice(['FTTB','FMC','other'],n,p=[.58,.27,.15]); giga=rng.choice(['yes','no'],n,p=[.27,.73])
    date=pd.Timestamp('2026-01-01')+pd.to_timedelta(rng.integers(0,240,n),unit='D')
    weekday=date.dayofweek.to_numpy(); hour=rng.integers(10,21,n)
    type_hd=np.where(bk=='Глобальная проблема','Авария',np.where(bk=='Подключение',rng.choice(['Конвергенция абонента','Работа с кабелем'],n),np.where(bk=='Дозаказ','Доставка оборудования','Ремонт')))
    complexity=(bk=='Глобальная проблема')*.22+(giga=='yes')*.11+(tech=='FMC')*.07
    speed=np.exp(-.07*(skill_level-1)-.018*np.minimum(exp,8)+complexity)
    actual=np.maximum(5,normative*speed+rng.normal(0,8+normative*.12,n)).round(1)
    logit_fix=.7+1.05*(skill_level-1)+.16*np.minimum(exp,8)-2.1*(bk=='Глобальная проблема')-.75*(giga=='yes')-.55*(tech=='FMC')+.35*(transport=='car')
    pfix=1/(1+np.exp(-logit_fix)); first=(rng.random(n)<pfix).astype(int)
    travel=np.maximum(2,rng.lognormal(np.log(22),.48,n)).round(1)
    route_pos=rng.integers(1,9,n); slack=np.clip(rng.normal(35,24,n)-2.7*(route_pos-1)-.22*travel,-25,110).round(1)
    planned_start=hour*60+rng.integers(0,60,n)
    logit_late=-3.6-.075*slack+.022*travel+.13*(route_pos-1)+.18*(bk=='Глобальная проблема')
    plate=1/(1+np.exp(-logit_late)); late=(rng.random(n)<plate).astype(int)
    df=pd.DataFrame({'event_date':date.astype(str),'engineer_id':eid,'required_skill':skill,'type_bk':bk,'type_hd':type_hd,
                     'transport':transport,'zone':zone,'technology':tech,'gigabit':giga,'hour':hour,'weekday':weekday,
                     'skill_level':skill_level,'engineer_experience':exp.round(2),'normative_duration':normative.astype(int),
                     'planned_start_minute':planned_start,'slack_minutes':slack,'planned_travel_minutes':travel,
                     'route_position':route_pos,'actual_duration_minutes':actual,'first_time_fix':first,'late_start':late})
    out=Path(args.out); out.parent.mkdir(parents=True,exist_ok=True); df.to_csv(out,index=False)
    print(f'wrote {len(df)} rows to {out}')

if __name__=='__main__': main()

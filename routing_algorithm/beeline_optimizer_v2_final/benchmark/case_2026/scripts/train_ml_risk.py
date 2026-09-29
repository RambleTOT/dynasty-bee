#!/usr/bin/env python3
from __future__ import annotations
import argparse, json
from pathlib import Path
import pandas as pd
from dispatch.ml_risk import train_operational_risk

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('csv'); ap.add_argument('--out',required=True); ap.add_argument('--origin',default='SYNTHETIC_DEMO_NOT_BEELINE'); args=ap.parse_args()
    df=pd.read_csv(args.csv)
    bundle=train_operational_risk(df,origin=args.origin)
    bundle.save(args.out)
    print(json.dumps(bundle.metrics,ensure_ascii=False,indent=2))

if __name__=='__main__': main()

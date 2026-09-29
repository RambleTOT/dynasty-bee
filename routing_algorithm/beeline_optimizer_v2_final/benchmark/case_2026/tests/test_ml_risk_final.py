from pathlib import Path
import os
import subprocess
import sys
import pandas as pd
import numpy as np
import pytest
from dispatch.ml_risk import OperationalRiskBundle, train_operational_risk
from dispatch.ml_integration import service_matrix
from dispatch.model import Task, Engineer, Instance


@pytest.fixture(scope='module')
def history_csv(tmp_path_factory):
    root=Path(__file__).resolve().parents[1]
    supplied=os.environ.get('BEE_METRICS_HISTORY_CSV')
    if supplied:
        return Path(supplied)
    out=tmp_path_factory.mktemp('ml_history')/'history.csv'
    subprocess.run([sys.executable,str(root/'scripts/generate_synthetic_history.py'),
                    '--rows','12000','--seed','42','--out',str(out)],check=True)
    return out


@pytest.fixture(scope='module')
def demo_bundle(history_csv):
    model_dir=os.environ.get('BEE_METRICS_MODEL_DIR')
    if model_dir:
        return OperationalRiskBundle.load(model_dir)
    history=pd.read_csv(history_csv)
    return train_operational_risk(history,origin='SYNTHETIC_DEMO_NOT_BEELINE')


def test_demo_bundle_loads_and_predicts(demo_bundle,history_csv):
    b=demo_bundle
    df=pd.read_csv(history_csv).tail(8)
    p50=b.predict_duration(df,'p50'); p90=b.predict_duration(df,'p90')
    ff=b.predict_first_fix(df); late=b.predict_late(df); success=b.predict_operational_success(df)
    assert len(p50)==8 and np.all(p90>0)
    assert np.all((ff>=0)&(ff<=1)) and np.all((late>=0)&(late<=1))
    assert np.all((success>=0)&(success<=1))
    assert getattr(b, 'operational_success', None) is not None


def test_service_matrix_from_pair_features(demo_bundle):
    b=demo_bundle
    t=[Task('R',1,70,600,800,'installation',priority_rank=2,type_bk='Подключение',type_hd='Конвергенция абонента',zone='moscow')]
    e=[Engineer('E01',0,600,1320,('installation',),'car',skill_levels=(('installation',2),),home_zone='moscow')]
    m=np.array([[0,10],[10,0]])
    ins=Instance(t,e,{'car':m},{'car':m*1000})
    row={'engineer_id':'E01','request_id':'R','required_skill':'installation','type_bk':'Подключение','type_hd':'Конвергенция абонента','transport':'car','zone':'moscow','technology':'FTTB','gigabit':'no','hour':10,'weekday':1,'skill_level':2,'engineer_experience':3.0,'normative_duration':70}
    sm=service_matrix(ins,pd.DataFrame([row]),b,'p50')
    assert sm.shape==(1,1) and sm[0,0]>0


def test_score_table_exposes_ui_risk_components(demo_bundle,history_csv):
    b=demo_bundle
    df=pd.read_csv(history_csv).tail(4)
    out=b.score_table(df)
    for col in ['service_p50_minutes','service_p90_minutes','p_first_time_fix','p_late_start','p_operational_success','p_revisit_or_failure','duration_uncertainty_minutes']:
        assert col in out
    assert np.all((out.p_operational_success>=0)&(out.p_operational_success<=1))
    assert np.all(out.service_p90_minutes>=out.service_p50_minutes)

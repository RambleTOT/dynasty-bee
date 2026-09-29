import pandas as pd
from dispatch.beeline_benchmark_v3 import _duration, _skill


def row(bk, hd):
    return pd.Series({"Тип заявки BK": bk, "Тип заявки HD": hd})


def test_official_service_norms_exclude_fixed_road_component():
    assert _duration(row("Подключение", "Заявка на подключение")) == 70
    assert _duration(row("Дозаказ", "Дозаказ оборудования")) == 20
    assert _duration(row("Локальная заявка", "Нет линка")) == 30
    assert _duration(row("Глобальная проблема", "Авария")) == 80


def test_global_problem_is_mapped_to_emergency_by_team_assumption():
    # Latest team decision: BK "Глобальная проблема" is treated as an emergency
    # until the case owner supplies a more specific classifier.
    assert _duration(row("Глобальная проблема", "Информация")) == 80
    assert _skill(row("Глобальная проблема", "Информация")) == "emergency"
    assert _skill(row("Глобальная проблема", "Авария")) == "emergency"

from dispatch.model import Task, Engineer, Instance
from dispatch.evaluate import Evaluator
from dispatch.master import recombine
import numpy as np


def test_replanning_master_prefers_stable_assignment_after_core_kpis():
    tasks=[Task('A',1,10,540,900,'local'),Task('B',2,10,540,900,'local')]
    eng=[Engineer('E1',0,540,1080,('local',),'car'),Engineer('E2',0,540,1080,('local',),'car')]
    mat=np.zeros((3,3),dtype=np.int64)
    ins=Instance(tasks,eng,{'car':mat},{'car':mat},
                 previous_assignment={'A':'E1','B':'E1'},
                 previous_predecessor={'A':None,'B':'A'})
    ev=Evaluator(ins)
    pool=[{(0,1)}, {(0,1)}]
    incumbent=[(),(0,1)]
    out,meta=recombine(ev,pool,incumbent,seconds=2)
    assert out==[(0,1),()]
    assert any(s['objective']=='stability_units' for s in meta['stages'])

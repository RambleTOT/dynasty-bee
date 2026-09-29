"""ML-модели: длительность работы и операционный риск визита.

Прогнозируют то, чего мы не знаем заранее. Жёсткие ограничения маршрута
модели не обходят никогда.

Модели (CatBoost, табличные признаки, пропуски и категории — без предобработки):
- длительность P50 и P90 (квантильная регрессия, P90 калибруется);
- P(устранено с первого выезда);
- P(опоздание к началу окна);
- P(успешный визит) = с первого раза и без опоздания.
Вероятности калибруются изотонической регрессией.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
import json
import numpy as np
import pandas as pd
import joblib
from catboost import CatBoostRegressor, CatBoostClassifier
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import roc_auc_score, brier_score_loss, mean_absolute_error

DEFAULT_FEATURES = [
    'engineer_id', 'required_skill', 'type_bk', 'type_hd', 'transport', 'zone',
    'technology', 'gigabit', 'hour', 'weekday', 'skill_level', 'engineer_experience',
    'normative_duration',
]
DEFAULT_CATEGORICAL = ['engineer_id', 'required_skill', 'type_bk', 'type_hd', 'transport',
                       'zone', 'technology', 'gigabit']


def _clean_frame(df: pd.DataFrame, columns: list[str]) -> pd.DataFrame:
    x = df.copy()
    for c in columns:
        if c not in x:
            x[c] = np.nan
    for c in DEFAULT_CATEGORICAL:
        if c in x:
            x[c] = x[c].fillna('__MISSING__').astype(str)
    return x[columns]


def _ece(y: np.ndarray, p: np.ndarray, bins: int = 10) -> float:
    """Ожидаемая ошибка калибровки: насколько вероятности расходятся с частотами."""
    edges = np.linspace(0, 1, bins + 1)
    out = 0.0
    for a, b in zip(edges[:-1], edges[1:]):
        mask = (p >= a) & (p < b if b < 1 else p <= b)
        if mask.any():
            out += mask.mean() * abs(float(y[mask].mean()) - float(p[mask].mean()))
    return float(out)


@dataclass
class OperationalRiskBundle:
    """Все обученные модели вместе с калибраторами и метаданными."""
    duration_p50: Any
    duration_p90: Any
    first_fix: Any
    late_start: Any
    first_fix_calibrator: Any
    late_calibrator: Any
    operational_success: Any = None
    operational_success_calibrator: Any = None
    feature_columns: list[str] = field(default_factory=lambda: list(DEFAULT_FEATURES))
    categorical: list[str] = field(default_factory=lambda: list(DEFAULT_CATEGORICAL))
    origin: str = 'UNKNOWN'
    duration_p90_offset: float = 0.0
    metrics: dict[str, Any] = field(default_factory=dict)

    def _x(self, df: pd.DataFrame) -> pd.DataFrame:
        return _clean_frame(df, self.feature_columns)

    def predict_duration(self, df: pd.DataFrame, quantile: str = 'p50') -> np.ndarray:
        x = self._x(df)
        if quantile.lower() == 'p90':
            pred = np.asarray(self.duration_p90.predict(x), dtype=float) + float(self.duration_p90_offset)
            # Две отдельные квантильные модели иногда пересекаются — P90 не ниже P50.
            p50 = np.asarray(self.duration_p50.predict(x), dtype=float)
            pred = np.maximum(pred, p50)
        else:
            pred = np.asarray(self.duration_p50.predict(x), dtype=float)
        return np.maximum(1.0, pred)

    def predict_first_fix(self, df: pd.DataFrame) -> np.ndarray:
        raw = np.asarray(self.first_fix.predict_proba(self._x(df)))[:, 1]
        return np.clip(self.first_fix_calibrator.predict(raw), 0, 1)

    def predict_late(self, df: pd.DataFrame) -> np.ndarray:
        x = self._x(df)
        raw = np.asarray(self.late_start.predict_proba(x))[:, 1]
        return np.clip(self.late_calibrator.predict(raw), 0, 1)

    def predict_operational_success(self, df: pd.DataFrame) -> np.ndarray:
        """P(успешный визит): с первого выезда и без опоздания.

        В новых моделях это отдельный классификатор. В старых — приближение
        P(с первого раза) × (1 − P(опоздание)).
        """
        model = getattr(self, 'operational_success', None)
        cal = getattr(self, 'operational_success_calibrator', None)
        if model is not None and cal is not None:
            raw = np.asarray(model.predict_proba(self._x(df)))[:, 1]
            return np.clip(cal.predict(raw), 0, 1)
        return self.predict_first_fix(df) * (1.0 - self.predict_late(df))

    def score_table(self, df: pd.DataFrame) -> pd.DataFrame:
        """Все прогнозы по парам «инженер × заявка» — готовая таблица для интерфейса."""
        out = df.copy()
        out['service_p50_minutes'] = self.predict_duration(df, 'p50')
        out['service_p90_minutes'] = self.predict_duration(df, 'p90')
        out['p_first_time_fix'] = self.predict_first_fix(df)
        out['p_late_start'] = self.predict_late(df)
        out['p_operational_success'] = self.predict_operational_success(df)
        out['p_revisit_or_failure'] = 1.0 - out['p_operational_success']
        out['duration_uncertainty_minutes'] = out['service_p90_minutes'] - out['service_p50_minutes']
        return out

    def save(self, folder: str | Path) -> None:
        folder = Path(folder)
        folder.mkdir(parents=True, exist_ok=True)
        joblib.dump(self, folder/'bundle.joblib')
        (folder/'metadata.json').write_text(json.dumps({
            'origin': self.origin, 'feature_columns': self.feature_columns,
            'categorical': self.categorical, 'duration_p90_offset': self.duration_p90_offset,
            'metrics': self.metrics,
        }, ensure_ascii=False, indent=2), encoding='utf8')

    @classmethod
    def load(cls, folder: str | Path) -> 'OperationalRiskBundle':
        return joblib.load(Path(folder)/'bundle.joblib')


def train_operational_risk(history: pd.DataFrame, *, origin: str,
                           time_column: str = 'event_date', seed: int = 42,
                           upper_coverage_target: float = 0.90,
                           upper_coverage_margin: float = 0.01) -> OperationalRiskBundle:
    """Обучает все модели на истории визитов.

    Выборка делится по времени: 70% обучение, 15% калибровка, 15% тест.
    Нужные метки: actual_duration_minutes, first_time_fix, late_start.
    late_start считается от обещанного клиенту окна. Признаки — только те,
    что известны до выезда.
    """
    required = {'actual_duration_minutes', 'first_time_fix', 'late_start'}
    missing = required - set(history.columns)
    if missing:
        raise ValueError(f'Missing ML targets: {sorted(missing)}')
    df = history.copy()
    if time_column in df:
        df = df.sort_values(time_column).reset_index(drop=True)
    n = len(df)
    if n < 300:
        raise ValueError('Need at least 300 historical rows for the demo trainer')
    a, b = int(n * .70), int(n * .85)
    train, cal, test = df.iloc[:a], df.iloc[a:b], df.iloc[b:]
    features = [c for c in DEFAULT_FEATURES if c in df.columns]
    # Контекст маршрута допустим как признак, только если известен до выезда.
    for c in ['planned_start_minute', 'slack_minutes', 'planned_travel_minutes',
              'route_position', 'predicted_duration_p50', 'predicted_duration_p90']:
        if c in df.columns:
            features.append(c)
    cats = [c for c in DEFAULT_CATEGORICAL if c in features]
    cat_idx = [features.index(c) for c in cats]
    Xtr, Xcal, Xte = (_clean_frame(x, features) for x in (train, cal, test))

    def qr(alpha):
        m = CatBoostRegressor(loss_function=f'Quantile:alpha={alpha}', iterations=260,
                              depth=6, learning_rate=.06, random_seed=seed, verbose=False,
                              allow_writing_files=False)
        m.fit(Xtr, train.actual_duration_minutes, cat_features=cat_idx)
        return m
    p50, p90 = qr(.5), qr(.9)
    # Сдвигаем P90 так, чтобы на калибровочной выборке он покрывал нужную долю визитов.
    raw90_cal = np.asarray(p90.predict(Xcal), dtype=float)
    calibration_level = min(0.999, max(0.5, float(upper_coverage_target + upper_coverage_margin)))
    p90_offset = float(np.quantile(cal.actual_duration_minutes.to_numpy() - raw90_cal,
                                   calibration_level, method='higher'))

    def clf(target):
        m = CatBoostClassifier(iterations=280, depth=6, learning_rate=.06,
                               loss_function='Logloss', random_seed=seed, verbose=False,
                               allow_writing_files=False)
        m.fit(Xtr, train[target].astype(int), cat_features=cat_idx)
        raw_cal = m.predict_proba(Xcal)[:, 1]
        iso = IsotonicRegression(out_of_bounds='clip').fit(raw_cal, cal[target].astype(int))
        raw_te = m.predict_proba(Xte)[:, 1]
        p_te = np.clip(iso.predict(raw_te), 0, 1)
        y = test[target].astype(int).to_numpy()
        auc = float(roc_auc_score(y, p_te)) if len(np.unique(y)) > 1 else float('nan')
        return m, iso, {'roc_auc': auc, 'brier': float(brier_score_loss(y, p_te)), 'ece': _ece(y, p_te)}

    ff, ff_iso, ffm = clf('first_time_fix')
    late, late_iso, latem = clf('late_start')
    # Успешный визит учим отдельной моделью — это честнее, чем перемножать две вероятности.
    work = df.copy()
    work['operational_success'] = ((work['first_time_fix'].astype(int) == 1)
                                   & (work['late_start'].astype(int) == 0)).astype(int)
    train2, cal2, test2 = work.iloc[:a], work.iloc[a:b], work.iloc[b:]
    m_success = CatBoostClassifier(iterations=300, depth=6, learning_rate=.06, loss_function='Logloss',
                                   random_seed=seed, verbose=False, allow_writing_files=False)
    m_success.fit(Xtr, train2['operational_success'], cat_features=cat_idx)
    raw_cal = m_success.predict_proba(Xcal)[:, 1]
    success_iso = IsotonicRegression(out_of_bounds='clip').fit(raw_cal, cal2['operational_success'])
    p_success = np.clip(success_iso.predict(m_success.predict_proba(Xte)[:, 1]), 0, 1)
    y_success = test2['operational_success'].to_numpy()
    successm = {
        'roc_auc': float(roc_auc_score(y_success, p_success)) if len(np.unique(y_success)) > 1 else float('nan'),
        'brier': float(brier_score_loss(y_success, p_success)),
        'ece': _ece(y_success, p_success),
    }
    pred50 = np.asarray(p50.predict(Xte), dtype=float)
    pred90 = np.maximum(np.asarray(p90.predict(Xte), dtype=float) + p90_offset, pred50)
    duration_metrics = {
        'p50_mae_minutes': float(mean_absolute_error(test.actual_duration_minutes, pred50)),
        'p90_coverage': float(np.mean(test.actual_duration_minutes.to_numpy() <= pred90)),
        'p90_target_coverage': float(upper_coverage_target),
        'p90_calibration_level': float(calibration_level),
        'test_rows': int(len(test)),
    }
    metrics = {'duration': duration_metrics, 'first_time_fix': ffm, 'late_start': latem,
               'operational_success': successm,
               'split': {'train': len(train), 'calibration': len(cal), 'test': len(test)}}
    return OperationalRiskBundle(p50, p90, ff, late, ff_iso, late_iso,
                                 m_success, success_iso, features, cats, origin=origin,
                                 duration_p90_offset=p90_offset, metrics=metrics)

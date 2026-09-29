"""Простая модель длительности: квантили CatBoost и калиброванная верхняя граница.

Модели, обученной на данных Билайна, здесь нет: в файлах кейса нет таких меток.
Проверка — по времени (обучение на прошлом, тест на будущем).
"""
from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path
import json
import math
import numpy as np
import pandas as pd


def chronological_split(frame: pd.DataFrame, date_column: str, train_fraction=.6, calibration_fraction=.2):
    """Делит по дням: обучение → калибровка → тест. Нужно минимум 5 дней."""
    if not (0 < train_fraction < 1 and 0 < calibration_fraction < 1-train_fraction):
        raise ValueError('Invalid split fractions')
    dates = pd.to_datetime(frame[date_column]).dt.floor('D')
    unique = np.sort(dates.dropna().unique())
    if len(unique) < 5 or dates.isna().any():
        raise ValueError('Need at least 5 complete chronological days')
    a = max(1, int(len(unique)*train_fraction))
    b = min(len(unique)-1, max(a+1, int(len(unique)*(train_fraction+calibration_fraction))))
    return (frame.loc[dates < unique[a]].copy(),
            frame.loc[(dates >= unique[a]) & (dates < unique[b])].copy(),
            frame.loc[dates >= unique[b]].copy())


@dataclass
class QuantileDurationModel:
    features: list[str]
    categorical: list[str]
    target: str = 'duration_minutes'
    alpha: float = .1
    iterations: int = 300
    seed: int = 42
    origin: str = 'UNSPECIFIED'

    def _x(self, frame):
        x = frame[self.features].copy()
        for name in self.features:
            if name in self.categorical:
                x[name] = x[name].fillna('__missing__').astype(str)
            else:
                x[name] = pd.to_numeric(x[name], errors='coerce')
                x[name] = x[name].replace([np.inf, -np.inf], np.nan)
        return x

    def fit(self, training: pd.DataFrame, calibration: pd.DataFrame):
        from catboost import CatBoostRegressor
        if self.origin == 'UNSPECIFIED':
            raise ValueError('Specify training-data origin; never present a synthetic/foreign model as locally calibrated')
        if not 0 < self.alpha < .5 or self.target in self.features:
            raise ValueError('Invalid alpha or target leakage')
        if not set(self.categorical).issubset(self.features):
            raise ValueError('Unknown categorical feature')
        for data in [training, calibration]:
            y = np.asarray(data[self.target], dtype=float)
            if len(y) == 0 or np.any(~np.isfinite(y)) or np.any(y < 0):
                raise ValueError('Durations must be finite and nonnegative')
        self.models = {}
        for q in [.5, 1-self.alpha]:
            model = CatBoostRegressor(loss_function=f'Quantile:alpha={q}', iterations=self.iterations,
                                      depth=6, learning_rate=.05, random_seed=self.seed,
                                      thread_count=1, verbose=False, allow_writing_files=False)
            model.fit(self._x(training), training[self.target], cat_features=self.categorical)
            self.models[q] = model
        raw = np.maximum(0, self.models[1-self.alpha].predict(self._x(calibration)))
        scores = np.asarray(calibration[self.target], dtype=float)-raw
        rank = math.ceil((len(scores)+1)*(1-self.alpha))
        if rank > len(scores):
            raise ValueError('Calibration set too small for requested alpha')
        self.correction = max(0., float(np.sort(scores)[rank-1]))
        self.calibration_size = len(scores)
        return self

    def predict(self, frame):
        if not hasattr(self, 'models'):
            raise ValueError('Model is not fitted')
        x = self._x(frame)
        median = np.maximum(0, self.models[.5].predict(x))
        upper_raw = np.maximum(0, self.models[1-self.alpha].predict(x))
        upper = np.maximum(median, upper_raw+self.correction)
        return pd.DataFrame({'median_minutes': median, 'raw_upper_minutes': upper_raw,
                             'calibrated_upper_minutes': upper}, index=frame.index)

    def evaluate(self, frame):
        p = self.predict(frame)
        y = np.asarray(frame[self.target], dtype=float)
        err = y-p['raw_upper_minutes'].to_numpy()
        q = 1-self.alpha
        return {'n': len(frame), 'origin': self.origin,
                'median_mae_minutes': float(np.abs(y-p['median_minutes']).mean()),
                'upper_pinball_loss': float(np.maximum(q*err, (q-1)*err).mean()),
                'upper_empirical_coverage': float(np.mean(y <= p['calibrated_upper_minutes'])),
                'nominal_coverage': 1-self.alpha, 'calibration_n': self.calibration_size,
                'warning': 'Empirical holdout coverage is not a guarantee under temporal/domain shift.'}

    def save(self, directory):
        directory = Path(directory)
        directory.mkdir(parents=True, exist_ok=True)
        self.models[.5].save_model(str(directory/'median.cbm'))
        self.models[1-self.alpha].save_model(str(directory/'upper.cbm'))
        meta = {name: getattr(self, name) for name in ['features', 'categorical', 'target', 'alpha',
                                                     'iterations', 'seed', 'origin', 'correction', 'calibration_size']}
        (directory/'metadata.json').write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding='utf8')

    @classmethod
    def load(cls, directory):
        from catboost import CatBoostRegressor
        directory = Path(directory)
        meta = json.loads((directory/'metadata.json').read_text(encoding='utf8'))
        correction = meta.pop('correction')
        size = meta.pop('calibration_size')
        obj = cls(**meta)
        obj.correction = correction
        obj.calibration_size = size
        obj.models = {}
        for q, name in [(.5, 'median'), (1-obj.alpha, 'upper')]:
            model = CatBoostRegressor()
            model.load_model(str(directory / f'{name}.cbm'))
            obj.models[q] = model
        return obj


def service_matrix(instance, feature_rows: pd.DataFrame, model: QuantileDurationModel, use_upper=False):
    """Матрица K × N длительностей. feature_rows — по строке на каждую пару (engineer_id, task_id)."""
    if feature_rows.duplicated(['engineer_id', 'task_id']).any():
        raise ValueError('Duplicate engineer/task rows')
    predictions = model.predict(feature_rows)
    column = 'calibrated_upper_minutes' if use_upper else 'median_minutes'
    lookup = {(str(row.engineer_id), str(row.task_id)): float(predictions.iloc[i][column])
              for i, row in enumerate(feature_rows.itertuples())}
    result = np.zeros((len(instance.engineers), len(instance.tasks)), dtype=np.int64)
    for k, e in enumerate(instance.engineers):
        for i, t in enumerate(instance.tasks):
            if (e.id, t.id) not in lookup:
                raise ValueError(f'Missing features for {e.id}/{t.id}')
            result[k, i] = math.ceil(lookup[e.id, t.id])
    return result

"""Синтетические задачи для тестов и демо. Координаты выдуманы, это не адреса клиентов."""
from __future__ import annotations
import numpy as np
from .model import Instance, Task, Engineer


def synthetic_instance(n=60, k=12, seed=1, pattern='mixed'):
    """n заявок, k инженеров. pattern: mixed / tight (узкие окна) / spread / clustered."""
    rng = np.random.default_rng(seed)
    modes = ['car', 'car', 'bike', 'public_transport', 'car', 'walk']
    skills = ['local', 'installation', 'emergency']
    size = 12.0 if pattern != 'spread' else 24.0
    locations = rng.uniform(0, size, size=(n+k, 2))
    if pattern == 'clustered':
        centers = np.array([[2., 2.], [8., 3.], [5., 9.]])
        locations[k:] = centers[rng.integers(0, 3, n)] + rng.normal(0, .7, (n, 2))
    locations[:k] = rng.uniform(size*.25, size*.75, (k, 2))
    d = np.sqrt(((locations[:, None]-locations[None, :])**2).sum(axis=2))
    distances, times = {}, {}
    for mode, speed, factor in [('car', 30, 1.28), ('walk', 5, 1.10),
                                ('bike', 14, 1.15), ('public_transport', 19, 1.35)]:
        distances[mode] = np.ceil(d*factor*1000).astype(np.int64)
        times[mode] = np.ceil(distances[mode]/1000/speed*60).astype(np.int64)
        if mode == 'public_transport':
            times[mode] += (distances[mode] > 0)*5
        np.fill_diagonal(times[mode], 0)
    engineers = []
    for j in range(k):
        s = tuple(skills if j % 4 == 0 else [skills[j % 3], skills[(j+1) % 3]])
        engineers.append(Engineer(f'E{j:02d}', j, 9*60, 19*60, s, modes[j % len(modes)]))
    tasks = []
    for i in range(n):
        opening = int(rng.choice(np.arange(9*60, 17*60+1, 30)))
        width = int(rng.choice([60, 90] if pattern == 'tight' else [120, 180, 240]))
        skill = skills[int(rng.choice([0, 1, 2], p=[.35, .5, .15]))]
        duration = int(rng.choice([20, 30, 45, 60]))
        transport = 'car' if rng.random() < .10 else None
        urgent = bool(rng.random() < .04)
        rank = 1 if urgent or skill == 'emergency' else 2 if skill == 'installation' else 3
        tasks.append(Task(f'T{i:03d}', k+i, duration, opening, min(18*60, opening+width),
                          skill, transport, urgent, priority_rank=rank))
    # Порядок заявок специально не отсортирован по окнам — как во входных данных для FIFO.
    return Instance(tasks, engineers, times, distances,
                    metadata={'synthetic': True, 'seed': seed, 'pattern': pattern,
                              'coordinates_km': locations.tolist(),
                              'warning': 'All coordinates, durations and workforce parameters are synthetic. No real-world efficiency claim.'})

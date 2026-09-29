"""Модель задачи: заявки, инженеры, матрицы движения.

Внутри библиотеки время хранится в целых минутах от 00:00, расстояние — в целых метрах.
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

MAX_MATRIX_VALUE = 100_000_000


def minutes(value: str | int) -> int:
    """'10:30' или 630 → 630 минут от начала суток."""
    if isinstance(value, str):
        h, m = map(int, value.split(':'))
        if not (0 <= m < 60 and h >= 0):
            raise ValueError(f'Invalid time: {value}')
        return 60 * h + m
    if isinstance(value, (int, np.integer)) and value >= 0:
        return int(value)
    raise ValueError('Times must be nonnegative integer minutes or HH:MM')


def clock(value: int | float) -> str:
    """630 → '10:30'."""
    value = int(round(value))
    return f'{value // 60:02d}:{value % 60:02d}'


def _is_int(value: Any) -> bool:
    return isinstance(value, (int, np.integer))


@dataclass(frozen=True)
class Task:
    """Заявка на выезд."""
    id: str
    node: int                      # индекс адреса в матрицах
    duration: int                  # работа на адресе, мин (без дороги)
    window_start: int              # окно начала работ, обещанное клиенту
    window_end: int
    skill: str                     # local / installation / emergency
    transport: str | None = None   # обязательный транспорт, если есть
    urgent: bool = False
    release_time: int = 0          # когда заявка появилась
    # Необязательные поля. Если заданы, это жёсткие ограничения, а не штрафы.
    min_skill_level: int = 1
    required_tools: tuple[str, ...] = ()
    priority_rank: int = 3         # 1 — авария, 2 — подключение, 3 — локальная / дозаказ
    type_bk: str | None = None
    type_hd: str | None = None
    zone: str | None = None        # Москва / город внутри участка


@dataclass(frozen=True)
class Engineer:
    """Инженер (бригада) на один рабочий день."""
    id: str
    start_node: int
    shift_start: int
    shift_end: int
    skills: tuple[str, ...]
    transport: str                 # car / walk / bike / public_transport
    used_today: bool = False       # уже работает сегодня — не считается «новым»
    available: bool = True
    locked_prefix: tuple[str, ...] = ()   # начатые/выполненные визиты, их не трогаем
    # Пары (навык, уровень). Навык из skills без уровня считается уровнем 1.
    skill_levels: tuple[tuple[str, int], ...] = ()
    tools: tuple[str, ...] = ()
    site_id: str | None = None
    home_zone: str | None = None


@dataclass
class Instance:
    """Всё, что нужно для планирования одного участка на один день."""
    tasks: list[Task]
    engineers: list[Engineer]
    travel_minutes: dict[str, np.ndarray]   # транспорт → матрица минут
    distance_m: dict[str, np.ndarray]       # транспорт → матрица метров
    service_by_engineer: np.ndarray | None = None   # K × N: длительность у конкретного инженера
    previous_assignment: dict[str, str] = field(default_factory=dict)
    previous_predecessor: dict[str, str | None] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)

    # --- проверка входа ---------------------------------------------------

    def validate(self) -> None:
        """Бросает ValueError, если данные противоречивы."""
        if not self.engineers:
            raise ValueError('At least one engineer is required')
        self._check_unique_ids()
        size = self._check_engineers_and_matrices()
        self._check_locked_prefixes()
        self._check_tasks(size)
        self._check_service_matrix()

    def _check_unique_ids(self) -> None:
        for ids, kind in [([t.id for t in self.tasks], 'task'),
                          ([e.id for e in self.engineers], 'engineer')]:
            if len(ids) != len(set(ids)):
                raise ValueError(f'Duplicate {kind} IDs')

    def _check_engineers_and_matrices(self) -> int:
        shapes = set()
        for e in self.engineers:
            if not isinstance(e.id, str) or not e.id:
                raise ValueError('Engineer IDs must be nonempty strings')
            if not all(_is_int(v) for v in (e.start_node, e.shift_start, e.shift_end)):
                raise ValueError('Engineer node/times must be integers')
            if e.shift_start < 0 or e.shift_start > e.shift_end:
                raise ValueError(f'Invalid shift: {e.id}')
            if not e.skills:
                raise ValueError(f'No skills: {e.id}')
            if any(level < 1 for _, level in e.skill_levels):
                raise ValueError(f'Invalid skill level: {e.id}')
            if len({name for name, _ in e.skill_levels}) != len(e.skill_levels):
                raise ValueError(f'Duplicate skill level entries: {e.id}')
            for source in (self.travel_minutes, self.distance_m):
                if e.transport not in source:
                    raise ValueError(f'Missing matrix for transport {e.transport}')
                shapes.add(_checked_matrix(source[e.transport]).shape)
        if len(shapes) != 1:
            raise ValueError('All matrices must use the same nodes and dimensions')
        size = next(iter(shapes))[0]
        for e in self.engineers:
            if not 0 <= e.start_node < size:
                raise ValueError(f'Invalid start node: {e.id}')
        return size

    def _check_locked_prefixes(self) -> None:
        all_ids = {t.id for t in self.tasks}
        locked = set()
        for e in self.engineers:
            for tid in e.locked_prefix:
                if tid not in all_ids or tid in locked:
                    raise ValueError(f'Unknown or multiply locked task: {tid}')
                locked.add(tid)

    def _check_tasks(self, size: int) -> None:
        for t in self.tasks:
            if not isinstance(t.id, str) or not t.id or not isinstance(t.skill, str) or not t.skill:
                raise ValueError('Task ID/skill must be nonempty strings')
            if not all(_is_int(v) for v in (t.node, t.duration, t.window_start, t.window_end, t.release_time)):
                raise ValueError('Task node/duration/times must be integers')
            if not 0 <= t.node < size:
                raise ValueError(f'Invalid node: {t.id}')
            if t.duration < 0 or t.window_start < 0 or t.window_end < t.window_start:
                raise ValueError(f'Invalid duration/window: {t.id}')
            if t.min_skill_level < 1:
                raise ValueError(f'Invalid minimum skill level: {t.id}')
            if t.priority_rank not in (1, 2, 3):
                raise ValueError(f'priority_rank must be 1, 2 or 3: {t.id}')
            if t.release_time < 0:
                raise ValueError(f'Invalid release time: {t.id}')

    def _check_service_matrix(self) -> None:
        if self.service_by_engineer is None:
            return
        a = np.asarray(self.service_by_engineer)
        if a.shape != (len(self.engineers), len(self.tasks)):
            raise ValueError('service_by_engineer must be K x N')
        if np.any(~np.isfinite(a)) or np.any(a < 0) or np.any(a != np.floor(a)):
            raise ValueError('Service durations must be finite nonnegative integers')

    # --- чтение и запись --------------------------------------------------

    @classmethod
    def from_dict(cls, obj: dict[str, Any]) -> 'Instance':
        tasks = [_task_from_dict(raw) for raw in obj['tasks']]
        engineers = [_engineer_from_dict(raw) for raw in obj['engineers']]
        service = obj.get('service_by_engineer')
        # Проверяем до приведения типов: молча обрезать дробные/отрицательные значения опасно.
        inst = cls(tasks, engineers,
                   {k: np.asarray(v) for k, v in obj['travel_minutes'].items()},
                   {k: np.asarray(v) for k, v in obj['distance_m'].items()},
                   None if service is None else np.asarray(service),
                   obj.get('previous_assignment', {}),
                   obj.get('previous_predecessor', {}),
                   obj.get('metadata', {}))
        inst.validate()
        return inst

    @classmethod
    def load(cls, path: str | Path) -> 'Instance':
        return cls.from_dict(json.loads(Path(path).read_text(encoding='utf8')))

    def to_dict(self) -> dict[str, Any]:
        service = self.service_by_engineer
        return {
            'tasks': [asdict(t) for t in self.tasks],
            'engineers': [asdict(e) for e in self.engineers],
            'travel_minutes': {k: np.asarray(v).tolist() for k, v in self.travel_minutes.items()},
            'distance_m': {k: np.asarray(v).tolist() for k, v in self.distance_m.items()},
            'service_by_engineer': None if service is None else service.tolist(),
            'previous_assignment': self.previous_assignment,
            'previous_predecessor': self.previous_predecessor,
            'metadata': self.metadata,
        }

    def save(self, path: str | Path) -> None:
        Path(path).write_text(json.dumps(self.to_dict(), ensure_ascii=False, indent=2), encoding='utf8')


def _checked_matrix(matrix: Any) -> np.ndarray:
    a = np.asarray(matrix)
    if a.ndim != 2 or a.shape[0] != a.shape[1]:
        raise ValueError('Matrices must be square')
    if np.any(~np.isfinite(a)) or np.any(a < 0) or np.any(a != np.floor(a)):
        raise ValueError('Matrices must contain finite nonnegative integers; '
                         'use a large sentinel for unreachable arcs')
    if np.any(np.diag(a) != 0):
        raise ValueError('Matrix diagonal must be zero')
    if np.max(a, initial=0) > MAX_MATRIX_VALUE:
        raise ValueError('Matrix value exceeds supported safe range')
    return a


def _default_priority(raw: dict[str, Any]) -> int:
    if raw.get('urgent', False) or raw.get('skill') == 'emergency':
        return 1
    if raw.get('skill') == 'installation':
        return 2
    return 3


def _task_from_dict(raw: dict[str, Any]) -> Task:
    raw = dict(raw)
    for name in ('window_start', 'window_end', 'release_time'):
        if name in raw:
            raw[name] = minutes(raw[name])
    raw['required_tools'] = tuple(raw.get('required_tools', []))
    raw.setdefault('priority_rank', _default_priority(raw))
    return Task(**raw)


def _engineer_from_dict(raw: dict[str, Any]) -> Engineer:
    raw = dict(raw)
    for name in ('shift_start', 'shift_end'):
        raw[name] = minutes(raw[name])
    raw['skills'] = tuple(raw['skills'])
    raw['locked_prefix'] = tuple(raw.get('locked_prefix', []))
    raw['skill_levels'] = tuple(tuple(x) for x in raw.get('skill_levels', []))
    raw['tools'] = tuple(raw.get('tools', []))
    return Engineer(**raw)


def is_compatible(e: Engineer, t: Task) -> bool:
    """Может ли инженер в принципе взять заявку: навык, уровень, транспорт, инструменты."""
    level = dict(e.skill_levels).get(t.skill, 1 if t.skill in e.skills else 0)
    return (e.available
            and level >= t.min_skill_level
            and (t.transport is None or t.transport == e.transport)
            and set(t.required_tools).issubset(e.tools))


@dataclass
class Arrays:
    """Та же задача в виде numpy-массивов для быстрых расчётов.

    Индексация: k — инженер, i — заявка, u/v — узлы матриц.
    """
    travel: np.ndarray          # K × V × V, минуты
    distance: np.ndarray        # K × V × V, метры
    service: np.ndarray         # K × N, минуты
    nodes: np.ndarray           # N
    opening: np.ndarray         # N, max(начало окна, время появления)
    closing: np.ndarray         # N, конец окна
    allowed: np.ndarray         # K × N, допустимые пары
    starts: np.ndarray          # K, стартовый узел
    shift_start: np.ndarray
    shift_end: np.ndarray
    urgent: np.ndarray
    priority_rank: np.ndarray
    used: np.ndarray
    locked: list[tuple[int, ...]]
    # Веса нужны только эвристикам построения. Сам план везде сравнивается
    # лексикографически: аварии → подключения → остальное → инженеры → километры.
    fleet_weight: float
    rank3_weight: float
    rank2_weight: float
    rank1_weight: float

    @property
    def missing_weight(self) -> float:
        # Для старого взвешенного column generation.
        return self.rank3_weight

    @property
    def urgent_weight(self) -> float:
        return self.rank1_weight - self.rank3_weight

    @classmethod
    def build(cls, ins: Instance, buffer: float = 1.0) -> 'Arrays':
        """buffer > 1 растягивает дорогу и работу — запас на неопределённость."""
        ins.validate()
        if buffer < 1:
            raise ValueError('Planning buffer must be at least 1')
        k, n = len(ins.engineers), len(ins.tasks)

        travel = np.stack([ins.travel_minutes[e.transport] for e in ins.engineers]).astype(np.int64)
        travel = np.ceil(travel * buffer).astype(np.int64)
        distance = np.stack([ins.distance_m[e.transport] for e in ins.engineers]).astype(np.int64)

        if ins.service_by_engineer is not None:
            service = ins.service_by_engineer.copy()
        else:
            service = np.tile([t.duration for t in ins.tasks], (k, 1))
        service = np.ceil(service * buffer).astype(np.int64)

        allowed = np.array([[is_compatible(e, t) for t in ins.tasks] for e in ins.engineers],
                           dtype=np.bool_).reshape(k, n)
        id_to_i = {t.id: i for i, t in enumerate(ins.tasks)}
        locked = [tuple(id_to_i[x] for x in e.locked_prefix) for e in ins.engineers]
        for owner, route in enumerate(locked):
            for i in route:
                # Замороженный визит остаётся у своего инженера, даже если тот стал
                # недоступен или сменил транспорт. Перераспределяется только хвост.
                allowed[:, i] = False
                allowed[owner, i] = True

        max_total_distance = float(n * np.max(distance, initial=0))
        fleet_w = max_total_distance + 1.0
        rank3_w = (k + 1) * fleet_w
        rank2_w = (n + 1) * rank3_w
        rank1_w = (n + 1) * rank2_w

        def int_array(values):
            return np.array(values, dtype=np.int64)

        return cls(
            travel=np.ascontiguousarray(travel),
            distance=np.ascontiguousarray(distance),
            service=np.ascontiguousarray(service),
            nodes=int_array([t.node for t in ins.tasks]),
            opening=int_array([max(t.window_start, t.release_time) for t in ins.tasks]),
            closing=int_array([t.window_end for t in ins.tasks]),
            allowed=allowed,
            starts=int_array([e.start_node for e in ins.engineers]),
            shift_start=int_array([e.shift_start for e in ins.engineers]),
            shift_end=int_array([e.shift_end for e in ins.engineers]),
            urgent=int_array([t.urgent or t.priority_rank == 1 for t in ins.tasks]),
            priority_rank=int_array([1 if t.urgent else t.priority_rank for t in ins.tasks]),
            used=int_array([e.used_today for e in ins.engineers]),
            locked=locked,
            fleet_weight=fleet_w,
            rank3_weight=rank3_w,
            rank2_weight=rank2_w,
            rank1_weight=rank1_w,
        )

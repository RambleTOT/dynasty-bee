"""Задачи из CSV кейса «Билайн Бизнес» для проверки алгоритма.

Из кейса берём: заявки, типы BK/HD, окна, районы и адреса, число бригад в истории,
адрес офиса участка.
Генерируем, потому что этого в файлах нет: координаты, матрицы движения, навыки,
транспорт, смены.
Длительность работ — по нормативам минус 20 минут дороги: дорогу считает матрица.
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import replace
from pathlib import Path

import numpy as np
import pandas as pd

from .model import Engineer, Instance, Task

# Скорость км/ч, накладные минуты на поездку, коэффициент длины пути.
# Для планирования на день берём средние скорости, как разрешено в Q&A.
MODES = {
    'public_transport': (18.0, 3.0, 1.12),
    'walk': (4.8, 0.0, 1.00),
    'car': (28.0, 1.5, 1.00),
    'bike': (14.0, 0.5, 1.04),
}

# Профили навыков и транспорта бригад. Генерируются независимо от истории назначений.
SKILL_PROFILES = [
    ('local', 'installation', 'emergency'),
    ('local', 'installation'),
    ('installation', 'emergency'),
    ('local', 'emergency'),
    ('local',),
    ('installation',),
]
TRANSPORTS = ['public_transport', 'public_transport', 'walk', 'car', 'car', 'bike']

# Работа на адресе без дороги, минуты.
SERVICE_MINUTES = {'Подключение': 70, 'Дозаказ': 20, 'Локальная заявка': 30, 'Авария на ТКД': 80}

SUBURBAN_CITIES = ('домодедово', 'кашир', 'ступино')


def decode_name(name: str) -> str:
    """'#U0410' в имени файла → 'А'."""
    return re.sub(r'#U([0-9A-Fa-f]{4})', lambda m: chr(int(m.group(1), 16)), name)


def _stable_u64(text: str) -> int:
    return int.from_bytes(hashlib.sha256(text.encode('utf8')).digest()[:8], 'little')


def _rng(key: str, seed: int) -> np.random.Generator:
    """Воспроизводимый генератор, привязанный к строке."""
    return np.random.default_rng((_stable_u64(key) + seed) % (2 ** 32))


def _find_pairs(root: str | Path):
    """Регион → {'control': путь, 'synthetic': путь}, только если есть оба файла."""
    regions = {}
    for p in Path(root).rglob('*.csv'):
        decoded = decode_name(p.name).replace('_', ' ')  # «Восток_Синтетические_данные.csv» тоже
        region = decoded.split(' Контрольное')[0].split(' Синтетические')[0].rstrip('.')
        if 'Контрольное' in decoded:
            regions.setdefault(region, {})['control'] = p
        if 'Синтетические' in decoded:
            regions.setdefault(region, {})['synthetic'] = p
    return {r: v for r, v in regions.items() if 'control' in v and 'synthetic' in v}


def available_regions(root: str | Path):
    return sorted(_find_pairs(root))


def _raw(path):
    return pd.read_csv(path, encoding='cp1251', sep=';')


def _valid_jobs(df):
    """Только строки с номером заявки и окном."""
    out = df.copy()
    out['_num'] = pd.to_numeric(out.get('Заявка'), errors='coerce')
    out = out[out['_num'].notna() & out['Начало'].notna() & out['Окончание'].notna()].copy()
    return out.reset_index(drop=True)


def _office_address(df):
    column = df['Заявка'].astype(str).str.casefold()
    mask = column.eq('адрес офиса') | column.eq('адрес офисa')   # вторая «a» — латинская
    if not mask.any():
        mask = column.str.contains('адрес офис', na=False)
    if not mask.any():
        return 'UNKNOWN_OFFICE'
    return str(df.loc[mask, 'Тип заявки BK'].iloc[0])


def _bk(row) -> str:
    return str(row.get('Тип заявки BK', '')).strip().casefold()


def _hd(row) -> str:
    return str(row.get('Тип заявки HD', '')).strip().casefold()


def _skill(row):
    bk = _bk(row)
    if 'глобаль' in bk:
        return 'emergency'
    if 'подключ' in bk or 'дозаказ' in bk:
        return 'installation'
    return 'local'


def _priority_rank(row):
    """Авария → подключение → ремонт / дозаказ.

    Равна ли любая «Глобальная проблема» аварии — вопрос открытый, поэтому
    ранг 1 получает только явная HD «Авария».
    """
    if 'авар' in _hd(row):
        return 1
    if 'подключ' in _bk(row):
        return 2
    return 3


def _duration(row):
    """Только работа на адресе; дорогу считает матрица."""
    bk = _bk(row)
    if 'глобаль' in bk:
        return SERVICE_MINUTES['Авария на ТКД']
    if 'дозаказ' in bk:
        return SERVICE_MINUTES['Дозаказ']
    if 'подключ' in bk:
        return SERVICE_MINUTES['Подключение']
    if 'локаль' in bk:
        return SERVICE_MINUTES['Локальная заявка']
    raise ValueError(f'Unmapped BK type: {row.get("Тип заявки BK")}')


def _required_transport(row):
    """Допущение команды: работа с кабелем, гигабит и явная авария требуют машину."""
    hd = _hd(row)
    giga = str(row.get('Гигабитное подключение', '')).strip().casefold()
    if 'кабел' in hd or giga in {'да', 'yes', '1', 'true'} or 'авар' in hd:
        return 'car'
    return None


def _zone(row):
    district = str(row.get('Район', '')).strip().casefold()
    for city in SUBURBAN_CITIES:
        if city in district:
            return city
    return 'moscow'


def _geometry(region: str, demand: pd.DataFrame, office: str, seed: int) -> np.ndarray:
    """Условные координаты, км. Узел 0 — офис, дальше заявки.

    Заявки одного района кучкуются, одного адреса — совпадают. Это не геокодирование.
    """
    districts = sorted(set(map(str, demand['Район'].fillna('unknown'))))
    centers = {d: _rng(region + '|district|' + d, seed).uniform([0, 0], [20, 16]) for d in districts}
    task_xy = []
    for _, row in demand.iterrows():
        d = str(row.get('Район', 'unknown'))
        rg = _rng(region + '|addr|' + str(row.get('Адрес', '')), seed)
        task_xy.append(centers[d] + rg.normal(0, .45, 2))
    task_xy = np.asarray(task_xy)
    office_xy = task_xy.mean(axis=0) + _rng(region + '|office|' + office, seed).normal(0, 1.5, 2)
    return np.vstack([office_xy[None, :], task_xy])


def _matrices(xy: np.ndarray):
    euclid = np.sqrt(((xy[:, None] - xy[None, :, :]) ** 2).sum(axis=2))
    base_km = euclid * 1.27
    travel, distance = {}, {}
    for mode, (speed, overhead, dist_factor) in MODES.items():
        dm = np.ceil(base_km * dist_factor * 1000).astype(np.int64)
        tm = np.ceil(base_km / speed * 60 + (euclid > 0) * overhead).astype(np.int64)
        np.fill_diagonal(dm, 0)
        np.fill_diagonal(tm, 0)
        travel[mode] = tm
        distance[mode] = dm
    return travel, distance


def _engineers(crews: list[str], region: str, seed: int) -> list[Engineer]:
    k = len(crews)
    engineers = []
    for idx, crew in enumerate(crews):
        skills = SKILL_PROFILES[(idx + seed) % len(SKILL_PROFILES)]
        transport = TRANSPORTS[(idx + 2 * seed) % len(TRANSPORTS)]
        # Смен в данных нет. Допущение: 10:00–22:00; одна-две смены короче,
        # чтобы ограничение по смене реально работало.
        shift = (10 * 60, 18 * 60) if idx in {0, max(0, k - 1)} else (10 * 60, 22 * 60)
        engineers.append(Engineer(
            crew, 0, shift[0], shift[1], tuple(skills), transport,
            skill_levels=tuple((sk, 2 if idx % 3 else 3) for sk in skills),
            site_id=region, home_zone='moscow'))
    return engineers


def _ensure_car_coverage(engineers: list[Engineer], demand: pd.DataFrame) -> list[Engineer]:
    """Каждый навык, нужный на заявках «только на машине», должен быть хоть у одного водителя.

    Если нет — добавляем навык водителю с самым узким профилем. Заявки не трогаем.
    """
    car_skills = {_skill(row) for _, row in demand.iterrows() if _required_transport(row) == 'car'}
    for skill in sorted(car_skills):
        if any(e.transport == 'car' and skill in e.skills for e in engineers):
            continue
        drivers = [(idx, e) for idx, e in enumerate(engineers) if e.transport == 'car']
        if not drivers:
            raise ValueError(f'No car engineer available to cover required skill {skill}')
        idx, e = min(drivers, key=lambda x: (len(x[1].skills), x[1].id))
        levels = dict(e.skill_levels)
        levels.setdefault(skill, 2)
        engineers[idx] = replace(e, skills=tuple(sorted(set(e.skills) | {skill})),
                                 skill_levels=tuple(sorted(levels.items())))
    return engineers


def _tasks(demand: pd.DataFrame) -> list[Task]:
    tasks = []
    for i, row in demand.iterrows():
        start = pd.to_datetime(row['Начало'], dayfirst=True, errors='raise')
        end = pd.to_datetime(row['Окончание'], dayfirst=True, errors='raise')
        rank = _priority_rank(row)
        tasks.append(Task(
            str(int(row['_num'])), 1 + i, _duration(row),
            int(start.hour * 60 + start.minute), int(end.hour * 60 + end.minute),
            _skill(row),
            transport=_required_transport(row),
            urgent=(rank == 1),
            priority_rank=rank,
            type_bk=str(row.get('Тип заявки BK', '')),
            type_hd=str(row.get('Тип заявки HD', '')),
            zone=_zone(row)))
    return tasks


def from_case_region(root: str | Path, region: str, seed: int = 1) -> Instance:
    """Задача на день для одного участка из пары CSV «Синтетические» + «Контрольное»."""
    pairs = _find_pairs(root)
    if region not in pairs:
        raise ValueError(region)
    raw_syn = _raw(pairs[region]['synthetic'])
    demand = _valid_jobs(raw_syn)
    control = _valid_jobs(_raw(pairs[region]['control']))
    office = _office_address(raw_syn)

    crews = sorted(map(str, control['Бригада'].dropna().unique())) if 'Бригада' in control else []
    if not crews:
        crews = [f'Engineer-{i + 1}' for i in range(max(6, round(len(demand) / 7)))]

    xy = _geometry(region, demand, office, seed)
    travel, distance = _matrices(xy)
    engineers = _ensure_car_coverage(_engineers(crews, region, seed), demand)
    tasks = _tasks(demand)

    return Instance(tasks, engineers, travel, distance, metadata={
        'benchmark_type': 'case_provided_QA_aligned_semi_synthetic',
        'region': region,
        'seed': seed,
        'office_address': office,
        'crew_count_reference': len(crews),
        'real_fields': ['BK/HD type', 'time window', 'district', 'address string',
                        'historical crew count', 'office address'],
        'official_service_minutes_without_travel': dict(SERVICE_MINUTES),
        'assumed_global_information_service_minutes': None,
        'assumed_global_information_task_ids': [],
        'generated_fields': ['geometry', 'modal travel matrices', 'skills', 'transport', 'shifts',
                             'required_transport'],
        'assumptions': [
            'one CSV equals one service site; cross-site assignment forbidden',
            'Moscow/suburban zones inside a site may be mixed but repeated zone switching is softly discouraged',
            'one brigade is one engineer',
            'no return to office',
            'client window constrains work start',
            'fixed 20-minute normative road component excluded to avoid double counting',
            'shift 10:00-22:00 is synthetic because no official shift answer was available in the export',
            'required_transport rules are team modelling assumptions',
        ],
        'coordinates_km': xy.tolist(),
    })

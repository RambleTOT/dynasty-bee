"""Чтение исходного архива кейса (ZIP с CSV) и его аудит.

Недостающие операционные данные (смены, навыки, матрицы) здесь не додумываются —
их нужно передать явно.
"""
from __future__ import annotations

import csv
import io
import zipfile
from collections import Counter
from datetime import datetime
from pathlib import Path

import numpy as np

from .model import Instance, Task

MAX_UNCOMPRESSED_BYTES = 100_000_000
OFFICE_MARKER = 'адрес офиса'


def fixed_name(name):
    """Исправляет кириллицу в именах файлов из ZIP (cp437 → utf8)."""
    try:
        return name.encode('cp437').decode('utf8')
    except (UnicodeEncodeError, UnicodeDecodeError):
        return name


def _decode(raw: bytes, name: str) -> tuple[str, str]:
    for encoding in ('utf-8-sig', 'cp1251'):
        try:
            return raw.decode(encoding), encoding
        except UnicodeDecodeError:
            continue
    raise ValueError(f'Unknown encoding: {name}')


def _parse_csv(raw: bytes, name: str) -> dict:
    """CSV кейса → строки заявок. Строки «Адрес офиса» в конце файла отделяются."""
    text, encoding = _decode(raw, name)
    dialect = csv.Sniffer().sniff(text[:8000], delimiters=';,\t')
    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    rows = [{str(k).strip(): str(v or '').strip() for k, v in row.items() if k is not None}
            for row in reader if any(row.values())]
    office_rows = [r for r in rows if r.get('Заявка', '').casefold() == OFFICE_MARKER]
    jobs = [r for r in rows if r.get('Заявка', '').casefold() != OFFICE_MARKER]
    return {'rows': jobs,
            'encoding': encoding,
            'delimiter': dialect.delimiter,
            'office_addresses': [r.get('Тип заявки BK', '') for r in office_rows],
            'footer_rows_removed': len(office_rows),
            'columns': list(reader.fieldnames or [])}


def read_archive(path):
    """Все CSV из архива, включая вложенные ZIP (не глубже двух уровней)."""
    files = {}

    def inspect(raw, depth=0):
        if depth > 2:
            raise ValueError('Unexpected archive nesting')
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            if sum(info.file_size for info in archive.infolist()) > MAX_UNCOMPRESSED_BYTES:
                raise ValueError('Archive exceeds 100 MB uncompressed safety limit')
            for info in archive.infolist():
                if info.is_dir():
                    continue
                name = fixed_name(info.filename)
                if name.lower().endswith('.zip'):
                    inspect(archive.read(info), depth + 1)
                elif name.lower().endswith('.csv'):
                    files[name] = _parse_csv(archive.read(info), name)

    inspect(Path(path).read_bytes())
    return files


def case_datetime(value):
    for form in ('%d.%m.%Y %H:%M', '%d.%m.%Y %H:%M:%S', '%Y-%m-%d %H:%M:%S'):
        try:
            return datetime.strptime(value, form)
        except ValueError:
            pass
    raise ValueError(f'Unrecognized case timestamp: {value!r}')


def audit_archive(path):
    """Сводка по архиву: что есть в файлах и чего не хватает для оптимизации и ML."""
    summaries = []
    for name, data in read_archive(path).items():
        rows = data['rows']
        days = Counter()
        invalid_times = []
        for pos, r in enumerate(rows):
            try:
                start, end = case_datetime(r['Начало']), case_datetime(r['Окончание'])
                days[str(start.date())] += 1
                if end < start:
                    invalid_times.append(pos)
            except (ValueError, KeyError):
                invalid_times.append(pos)
        has_brigade = 'Бригада' in data['columns']
        summaries.append({
            'file': name,
            'rows': len(rows),
            'unique_ids': len({r.get('Заявка', '') for r in rows}),
            'encoding': data['encoding'],
            'delimiter': data['delimiter'],
            'columns': data['columns'],
            'office_addresses_from_footer': data['office_addresses'],
            'footer_rows_removed': data['footer_rows_removed'],
            'dates': dict(days),
            'invalid_time_row_indices': invalid_times,
            'bk_types': dict(Counter(r.get('Тип заявки BK', '') for r in rows)),
            'hd_types': dict(Counter(r.get('Тип заявки HD', '') for r in rows)),
            'missing_addresses': sum(not r.get('Адрес', '') for r in rows),
            'missing_brigade_count': sum(not r.get('Бригада', '') for r in rows) if has_brigade else None,
        })
    return {
        'files': summaries,
        'missing_for_optimization': [
            'engineer shifts, skills, transport and a confirmed link to start nodes '
            '(office addresses exist in CSV footers)',
            'job service durations',
            'geocoded nodes and modal travel/distance matrices',
            'explicit priority/release-time mapping where absent',
        ],
        'missing_for_supervised_risk_training': [
            'actual trip departure/arrival times',
            'actual work start/finish times',
            'multiple chronological days',
        ],
        'warning': 'Control assignments are not optimal solutions and are not outcome labels. '
                   'Synthetic and control files are not guaranteed to be row-aligned.',
    }


def normalize_requests(rows, engineers, request_nodes, duration_by_type, skill_by_type,
                       travel_minutes, distance_m, urgent_ids=None):
    """Строки CSV → Instance. Все недостающие данные передаются явно.

    duration_by_type и skill_by_type — по точному тексту типа BK. Незнакомый тип —
    ошибка, а не «удобное» значение по умолчанию. urgent_ids задаёт аварии явно.
    """
    urgent_ids = set(urgent_ids or [])
    tasks = []
    dates = set()
    for row in rows:
        tid, kind = row['Заявка'], row['Тип заявки BK']
        if tid not in request_nodes or kind not in duration_by_type or kind not in skill_by_type:
            raise ValueError(f'Missing explicit node/duration/skill mapping for request {tid}, type {kind}')
        if (not isinstance(request_nodes[tid], (int, np.integer))
                or not isinstance(duration_by_type[kind], (int, np.integer))):
            raise ValueError('Explicit node/duration mappings must be integers; '
                             'round conservatively before normalization')
        start, end = case_datetime(row['Начало']), case_datetime(row['Окончание'])
        if start.date() != end.date():
            raise ValueError('Multi-day windows need a shared absolute-minute origin; not silently truncated')
        dates.add(start.date())
        tasks.append(Task(tid, int(request_nodes[tid]), int(duration_by_type[kind]),
                          start.hour * 60 + start.minute, end.hour * 60 + end.minute,
                          skill_by_type[kind], urgent=tid in urgent_ids))
    if len(dates) > 1:
        raise ValueError('Split the input into days before normalization')
    ins = Instance(tasks, engineers, travel_minutes, distance_m,
                   metadata={'request_source': 'provided case CSV',
                             'operational_mappings': 'explicit caller-supplied, verify before deployment',
                             'date': str(next(iter(dates))) if dates else None})
    ins.validate()
    return ins

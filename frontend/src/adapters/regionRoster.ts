/**
 * Бригады своего участка (§14, `anyRegionEnabled`). Откуда берём состав:
 * - контрольный файл — имена из колонки «Бригада», навыки — по заявкам, которые бригаде дал реальный
 *   диспетчер;
 * - файл бригад — любые колонки (имя обязательно, навыки, транспорт, смена);
 * - сохранённые бригады участка (`GET /regions/{id}/roster`);
 * - правило: бригада на 5–6 заявок, не меньше трёх, «Аварийные работы» — у каждой 4-й.
 * Диспетчер правит состав в таблице; на бэк он уходит ростером участка и файлом `engineers_file`.
 */
import type { RosterEngineer } from '@/api/types';
import { plural } from '@/lib/format';
import { isSkill, isTransport, SKILLS, type Skill, type Transport } from '@/lib/statuses';
import {
  parseClock,
  parseSkillsCell,
  parseTransportCell,
  type Mapping,
  type RequestRow,
  type RosterField,
} from './columnMap';
import type { CsvTable } from './csvTable';

export interface RosterRow {
  /** Ключ строки таблицы (React), не id бригады. */
  key: string;
  /** id бригады на бэке; `''` — новая, id выдадим при загрузке. */
  id: string;
  name: string;
  skills: Skill[];
  transport: Transport;
  shiftStart: string;
  shiftEnd: string;
}

export type RosterSource = 'control' | 'file' | 'saved' | 'rule';

export const ROSTER_SOURCE_LABEL: Record<RosterSource, string> = {
  control: 'Из контрольного файла',
  file: 'Из файла бригад',
  saved: 'Сохранённые бригады участка',
  rule: 'По правилу',
};

export interface Shift {
  start: string;
  end: string;
}

/** Смена бригад кейса (бэк: `SHIFT_START`, `SHIFT_END`) — только если в файле нет ни одного окна. */
const CASE_SHIFT: Shift = { start: '10:00', end: '22:00' };

/** Окно «на весь день» (аварии 00:01–23:59) смену не задаёт. */
const WHOLE_DAY_MIN = 12 * 60;
const toMin = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));

/** Смена по окнам заявок: от самого раннего начала до самого позднего конца. */
export function shiftOf(requests: readonly Pick<RequestRow, 'start' | 'end'>[]): Shift {
  let start: string | null = null;
  let end: string | null = null;
  for (const row of requests) {
    if (!row.start || !row.end || toMin(row.end) - toMin(row.start) >= WHOLE_DAY_MIN) continue;
    if (!start || row.start < start) start = row.start;
    if (!end || row.end > end) end = row.end;
  }
  return start && end ? { start, end } : CASE_SHIFT;
}

let keySeq = 0;
export const newRowKey = () => `row-${(keySeq += 1)}`;

const sortSkills = (skills: Iterable<Skill>) =>
  SKILLS.filter((skill) => [...skills].includes(skill));

export function emptyRosterRow(shift: Shift, name = ''): RosterRow {
  return {
    key: newRowKey(),
    id: '',
    name,
    skills: ['installation', 'local'],
    transport: 'car',
    shiftStart: shift.start,
    shiftEnd: shift.end,
  };
}

/** Имена из «Бригады» в порядке появления, навыки — по типам заявок бригады. */
export function rosterFromControl(
  requests: readonly RequestRow[],
  brigades: ReadonlyMap<number, string>,
  skillOf: (row: RequestRow) => Skill,
  shift: Shift,
): RosterRow[] {
  const skills = new Map<string, Set<Skill>>();
  for (const row of requests) {
    const name = brigades.get(row.source);
    if (!name) continue;
    const own = skills.get(name) ?? new Set<Skill>();
    own.add(skillOf(row));
    skills.set(name, own);
  }
  return [...skills].map(([name, own]) => ({
    ...emptyRosterRow(shift, name),
    skills: sortSkills(own),
  }));
}

/** Файл бригад: имя обязательно; нет колонки навыков — все три, транспорт — автомобиль. */
export function rosterFromFile(
  table: CsvTable,
  mapping: Mapping<RosterField>,
  shift: Shift,
): RosterRow[] {
  const cell = (cells: string[], field: RosterField) => {
    const column = mapping[field];
    return column === null ? '' : (cells[column] ?? '').trim();
  };
  const seen = new Set<string>();
  const rows: RosterRow[] = [];
  for (const cells of table.rows) {
    const name = cell(cells, 'name');
    if (!name || seen.has(name)) continue;
    seen.add(name);
    rows.push({
      ...emptyRosterRow(shift, name),
      skills: mapping.skills === null ? [...SKILLS] : parseSkillsCell(cell(cells, 'skills')),
      transport: parseTransportCell(cell(cells, 'transport')) ?? 'car',
      shiftStart: parseClock(cell(cells, 'shiftStart')) ?? shift.start,
      shiftEnd: parseClock(cell(cells, 'shiftEnd')) ?? shift.end,
    });
  }
  return rows;
}

export function rosterFromSaved(engineers: readonly RosterEngineer[]): RosterRow[] {
  return engineers.map((engineer) => ({
    key: newRowKey(),
    id: engineer.id,
    name: engineer.name,
    skills: sortSkills(engineer.skills.filter(isSkill)),
    transport: isTransport(engineer.transport) ? engineer.transport : 'car',
    shiftStart: engineer.shift_start.slice(0, 5),
    shiftEnd: engineer.shift_end.slice(0, 5),
  }));
}

/** Заявок на бригаду в правиле — как в кейсе: 66 заявок Востока на 12 бригад. */
const REQUESTS_PER_BRIGADE = 5.5;
const MIN_BRIGADES = 3;

/** Правило: бригада на 5–6 заявок, не меньше трёх; «Аварийные работы» — у каждой 4-й и хотя бы у одной. */
export function rosterByRule(requestCount: number, shift: Shift): RosterRow[] {
  const count = Math.max(MIN_BRIGADES, Math.ceil(requestCount / REQUESTS_PER_BRIGADE));
  return Array.from({ length: count }, (_, index) => ({
    ...emptyRosterRow(shift, `Бригада ${index + 1}`),
    skills: index % 4 === 0 ? [...SKILLS] : ['local', 'installation'],
  }));
}

export interface RosterCheck {
  /** Загрузить нельзя. */
  errors: string[];
  /** Загрузить можно, но часть заявок не назначится. */
  warnings: string[];
}

const SKILL_TEXT: Record<Skill, string> = {
  local: 'Локальные работы',
  installation: 'Работы на подключение и дозаказы',
  emergency: 'Аварийные работы',
};

/** Проверка состава; `need` — сколько заявок требует каждый навык. */
export function checkRoster(
  rows: readonly RosterRow[],
  need: ReadonlyMap<Skill, number>,
): RosterCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (rows.length === 0) errors.push('Добавьте хотя бы одну бригаду');
  const names = rows.map((row) => row.name.trim());
  if (names.some((name) => !name)) errors.push('У каждой бригады должно быть имя');
  const repeated = [
    ...new Set(names.filter((name, index) => name && names.indexOf(name) !== index)),
  ];
  if (repeated.length) errors.push(`Имена повторяются: ${repeated.join(', ')}`);
  if (rows.some((row) => row.skills.length === 0))
    errors.push('У каждой бригады — хотя бы один навык');
  if (rows.some((row) => !row.shiftStart || !row.shiftEnd || row.shiftStart >= row.shiftEnd))
    errors.push('Смена: начало раньше конца');
  for (const [skill, count] of need) {
    if (count > 0 && !rows.some((row) => row.skills.includes(skill)))
      warnings.push(
        `Ни у одной бригады нет навыка «${SKILL_TEXT[skill]}»: ${count} ${plural(count, [
          'заявка не назначится',
          'заявки не назначатся',
          'заявок не назначатся',
        ])}`,
      );
  }
  return { errors, warnings };
}

/** id для новых бригад: E01, E02… без повторов с уже выданными. */
export function withIds(rows: readonly RosterRow[]): RosterRow[] {
  const used = new Set(rows.map((row) => row.id).filter(Boolean));
  let next = 1;
  return rows.map((row) => {
    if (row.id) return row;
    let id = `E${String(next).padStart(2, '0')}`;
    while (used.has(id)) {
      next += 1;
      id = `E${String(next).padStart(2, '0')}`;
    }
    used.add(id);
    next += 1;
    return { ...row, id };
  });
}

/** Ростер для бэка: старт — офис участка (GPS нет). */
export function toRosterEngineers(
  rows: readonly RosterRow[],
  office: { lat: number; lon: number },
): RosterEngineer[] {
  return withIds(rows).map((row) => ({
    id: row.id,
    name: row.name.trim(),
    latitude: office.lat,
    longitude: office.lon,
    shift_start: row.shiftStart,
    shift_end: row.shiftEnd,
    skills: row.skills,
    transport: row.transport,
    available: true,
  }));
}

const csvCell = (value: string) =>
  /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

/**
 * `engineers_file` для `POST /data/import-beeline` — формат, который бэк уже читает
 * (`_parse_engineers_file`): разделитель «,», навыки через «;».
 */
export function engineersCsv(engineers: readonly RosterEngineer[]): string {
  const header = 'id,name,latitude,longitude,shift_start,shift_end,skills,transport,available';
  const lines = engineers.map((engineer) =>
    [
      engineer.id,
      engineer.name,
      String(engineer.latitude),
      String(engineer.longitude),
      engineer.shift_start,
      engineer.shift_end,
      engineer.skills.join(';'),
      engineer.transport,
      engineer.available === false ? 'false' : 'true',
    ]
      .map(csvCell)
      .join(','),
  );
  return [header, ...lines].join('\n');
}

/**
 * «Состав и ресурсы» (DS-09, FRONTEND_SPEC §8.2): строки ростера, черновик правок, дифф для PATCH / POST
 * до публикации, событие после публикации — по одному изменению за раз [Д], бригада-кандидат и текст
 * рекомендации из `extend-resource`. Ответы ростера и `cost` в схеме нетипизированы: читаем безопасно.
 */
import type { DispatcherEvent } from '@/api/events';
import type { ExtraEngineer } from '@/api/planning';
import type {
  EngineerCreate,
  EngineerOut,
  EngineerPatch,
  ExtendResourceCheckResponse,
  ExtendResourceResponse,
} from '@/api/types';
import { colorForPosition, engineerColors, type EngineerColor } from '@/lib/colors';
import { SKILL_SHORT, TRANSPORT_SHORT, transportLabel } from '@/lib/dictionaries';
import { transportOn } from '@/lib/explainTexts';
import { countOf, plural, PL_REQUEST } from '@/lib/format';
import { isSkill, isTransport, labelOf, SKILL_LABEL, TRANSPORTS } from '@/lib/statuses';
import { toMin, windowFull } from '@/lib/time';
import type { DayModel, DayRequest } from './dayModel';
import { engineerLabels } from './normalize';

export interface RosterRow {
  id: string;
  label: string;
  color: EngineerColor;
  skills: string[];
  /** «Подкл.», «Лок.», «Авария» — один словарь сокращений (§8.2, таблица макета, п. 22). */
  skillChips: string[];
  /** Фактический транспорт, если инженер его сменил, иначе по справочнику. */
  transport: string;
  shiftStart: string;
  shiftEnd: string;
  /** «10:00–22:00» — из данных бригады. */
  shiftText: string;
  available: boolean;
}

const byId = (a: { id: string }, b: { id: string }) =>
  a.id.localeCompare(b.id, 'ru', { numeric: true });

export function rosterRows(
  engineers: readonly EngineerOut[] | null | undefined,
  model: Pick<DayModel, 'engineerById'>,
): RosterRow[] {
  const list = (engineers ?? []).filter((e) => typeof e?.id === 'string' && e.id).sort(byId);
  const colors = engineerColors(list.map((e) => e.id));
  return list.map((engineer) => {
    const skills = Array.isArray(engineer.skills) ? engineer.skills : [];
    return {
      id: engineer.id,
      label: engineerLabels(engineer).label,
      color:
        model.engineerById.get(engineer.id)?.color ??
        colors.get(engineer.id) ??
        colorForPosition(0),
      skills,
      skillChips: skills.map((skill) => labelOf(SKILL_SHORT, skill)),
      transport: engineer.actual_transport || engineer.transport || '',
      shiftStart: engineer.shift_start ?? '',
      shiftEnd: engineer.shift_end ?? '',
      shiftText: windowFull(engineer.shift_start ?? '', engineer.shift_end ?? ''),
      available: engineer.available !== false,
    };
  });
}

/** Смена новой бригады по умолчанию — самая частая в ростере региона. Ростер пуст — `null`. */
export function commonShift(
  rows: readonly Pick<RosterRow, 'shiftStart' | 'shiftEnd'>[],
): { start: string; end: string } | null {
  const counts = new Map<string, number>();
  let best: string | null = null;
  for (const row of rows) {
    if (!Number.isFinite(toMin(row.shiftStart)) || !Number.isFinite(toMin(row.shiftEnd))) continue;
    const key = `${row.shiftStart}|${row.shiftEnd}`;
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    if (best == null || n > (counts.get(best) ?? 0)) best = key;
  }
  if (!best) return null;
  const [start, end] = best.split('|');
  return { start, end };
}

/** Варианты транспорта: четыре из справочника; незнакомый с бэка — как есть. */
export function transportOptions(current: string): { value: string; label: string }[] {
  const options = TRANSPORTS.map((t) => ({ value: t as string, label: TRANSPORT_SHORT[t] }));
  if (current && !isTransport(current))
    options.push({ value: current, label: transportLabel(current) });
  return options;
}

// ---------- черновик ----------

export interface RosterChange {
  transport?: string;
  available?: boolean;
}

export interface NewEngineer {
  key: string;
  name: string;
  skills: string[];
  transport: string;
  shiftStart: string;
  shiftEnd: string;
}

export interface RosterDraft {
  changes: Readonly<Record<string, RosterChange>>;
  additions: readonly NewEngineer[];
}

export const EMPTY_DRAFT: RosterDraft = { changes: {}, additions: [] };

/** Правка поля бригады: вернули исходное значение — правка исчезает. */
export function setChange<K extends keyof RosterChange>(
  draft: RosterDraft,
  row: Pick<RosterRow, 'id' | 'transport' | 'available'>,
  field: K,
  value: NonNullable<RosterChange[K]>,
): RosterDraft {
  const change: RosterChange = { ...draft.changes[row.id] };
  if (row[field] === value) delete change[field];
  else change[field] = value;
  const changes = { ...draft.changes };
  if (Object.keys(change).length > 0) changes[row.id] = change;
  else delete changes[row.id];
  return { ...draft, changes };
}

export interface RosterDiff {
  patches: { engineerId: string; patch: EngineerPatch }[];
  additions: EngineerCreate[];
  /** Отдельных изменений: поле бригады или новая бригада. */
  count: number;
}

export function toEngineerCreate(engineer: Omit<NewEngineer, 'key'>): EngineerCreate {
  return {
    name: engineer.name.trim(),
    skills: [...engineer.skills],
    transport: engineer.transport,
    shift_start: engineer.shiftStart,
    shift_end: engineer.shiftEnd,
    start: 'office',
  };
}

export function rosterDiff(rows: readonly RosterRow[], draft: RosterDraft): RosterDiff {
  const patches: RosterDiff['patches'] = [];
  let count = 0;
  for (const row of rows) {
    const change = draft.changes[row.id];
    if (!change) continue;
    const patch: EngineerPatch = {};
    if (change.transport !== undefined && change.transport !== row.transport)
      patch.transport = change.transport;
    if (change.available !== undefined && change.available !== row.available)
      patch.available = change.available;
    const fields = Object.keys(patch).length;
    if (fields > 0) {
      patches.push({ engineerId: row.id, patch });
      count += fields;
    }
  }
  const additions = draft.additions.map(toEngineerCreate);
  return { patches, additions, count: count + additions.length };
}

/** Единственная правка после публикации: остальные контролы блокируем. */
export type RosterLock =
  { kind: 'engineer'; engineerId: string; field: keyof RosterChange } | { kind: 'addition' } | null;

export function pendingLock(rows: readonly RosterRow[], draft: RosterDraft): RosterLock {
  const diff = rosterDiff(rows, draft);
  if (diff.additions.length > 0) return { kind: 'addition' };
  const first = diff.patches[0];
  if (!first) return null;
  return {
    kind: 'engineer',
    engineerId: first.engineerId,
    field: first.patch.transport !== undefined ? 'transport' : 'available',
  };
}

/**
 * После публикации правка состава — событие `apply: false` → предложение (§8.2):
 * транспорт — `transport_changed`, выключение — `engineer_unavailable`, включение — `engineer_available`.
 */
export function rosterEvent(
  diff: RosterDiff,
  planId: string,
  eventTime: string,
): DispatcherEvent | null {
  if (diff.count !== 1 || diff.patches.length !== 1) return null;
  const { engineerId, patch } = diff.patches[0];
  const base = { plan_id: planId, event_time: eventTime, engineer_id: engineerId };
  if (patch.transport)
    return { type: 'transport_changed', ...base, params: { transport: patch.transport } };
  if (patch.available === false) return { type: 'engineer_unavailable', ...base };
  if (patch.available === true) return { type: 'engineer_available', ...base };
  return null;
}

/** P1-6: новая бригада после публикации — событие `engineer_added`, id выдаёт бэк. */
export function engineerAddedEvent(
  engineer: EngineerCreate,
  planId: string,
  eventTime: string,
  office: LatLngLike | null,
): DispatcherEvent {
  return {
    type: 'engineer_added',
    plan_id: planId,
    event_time: eventTime,
    engineer: {
      name: engineer.name,
      skills: [...engineer.skills],
      transport: engineer.transport,
      shift_start: engineer.shift_start,
      shift_end: engineer.shift_end,
      start: { kind: 'office' },
      ...(office ? { latitude: office[0], longitude: office[1] } : {}),
    },
  };
}

/** Id бригады, которую только что добавили: новая в ростере, по имени (бэк id не возвращает). */
export function createdEngineerId(
  before: readonly string[],
  after: readonly EngineerOut[] | null | undefined,
  name: string,
): string | null {
  const known = new Set(before);
  const fresh = (after ?? []).filter((e) => typeof e?.id === 'string' && !known.has(e.id));
  const byName = fresh.find((e) => (e.name ?? '').trim() === name.trim());
  return (byName ?? (fresh.length === 1 ? fresh[0] : null))?.id ?? null;
}

// ---------- рекомендация «не хватает +N инженера» ----------

type LatLngLike = readonly [number, number];

const SKILL_ORDER = ['installation', 'local', 'emergency'] as const;

/**
 * Бригада-кандидат для расчёта добора: навыки — все, что нужны неназначенным; транспорт — автомобиль,
 * если он нужен хоть одной (или никакой не указан); смена — самая частая в ростере; старт — офис.
 * Собрать нельзя (нет навыков, смены или точки старта) — `null`, плашку не показываем (§8.2).
 */
export function extraEngineer(
  requests: readonly Pick<DayRequest, 'raw'>[],
  rows: readonly Pick<RosterRow, 'id' | 'shiftStart' | 'shiftEnd'>[],
  start: LatLngLike | null,
): ExtraEngineer | null {
  const needed = new Set(requests.map((r) => r.raw.required_skill).filter(isSkill));
  const skills = SKILL_ORDER.filter((skill) => needed.has(skill));
  const shift = commonShift(rows);
  if (skills.length === 0 || !shift || !start) return null;
  const transports = requests
    .map((r) => r.raw.required_transport)
    .filter((t): t is string => typeof t === 'string' && t.length > 0);
  const transport = transports.length === 0 || transports.includes('car') ? 'car' : transports[0];
  const ids = new Set(rows.map((r) => r.id));
  let n = 1;
  while (ids.has(`EXTRA-${n}`)) n += 1;
  return {
    id: `EXTRA-${n}`,
    name: 'Дополнительная бригада',
    skills: [...skills],
    transport,
    shift_start: shift.start,
    shift_end: shift.end,
    latitude: start[0],
    longitude: start[1],
    start_kind: 'office',
  };
}

export interface ResourceAdvice {
  text: string;
  tone: 'info' | 'warning';
  /** Предложение, которое бэк без P1-5 сохраняет при расчёте (DS-07); иначе `null`. */
  proposalId: string | null;
  /** Кандидат закрывает хотя бы одну заявку — его можно добавить в состав. */
  helps: boolean;
}

const PL_UNASSIGNED_ACC = ['неназначенную', 'неназначенные', 'неназначенных'] as const;

const skillsText = (skills: readonly string[]) =>
  skills.length === 0
    ? ''
    : ` с ${skills.length > 1 ? 'навыками' : 'навыком'} ${skills
        .map((skill) => `«${labelOf(SKILL_LABEL, skill)}»`)
        .join(', ')}`;

/**
 * Ответ `extend-resource` или `extend-resource/check` с бригадой-кандидатом → плашка DS-09:
 * «Чтобы назначить 3 неназначенные, не хватает +1 инженера с навыком «Аварийные работы» и на
 * автомобиле; ещё 2 заявки останутся без исполнителя». `closed` пуст — кандидат не поможет.
 */
export function resourceAdvice(
  response: ExtendResourceResponse | ExtendResourceCheckResponse | null | undefined,
  requested: number,
  candidate: Pick<ExtraEngineer, 'skills' | 'transport'>,
): ResourceAdvice {
  const closedList = Array.isArray(response?.closed) ? response.closed : null;
  if (!response || !closedList) {
    return { text: 'Не удалось рассчитать добор ресурса', tone: 'warning', proposalId: null, helps: false };
  }
  const proposalId = ('plan' in response ? response.plan?.plan_id : null) ?? null;
  const closed = closedList.length;
  const still = Array.isArray(response.still_unassigned)
    ? response.still_unassigned.length
    : Math.max(0, requested - closed);
  if (closed === 0) {
    return {
      text: 'Даже с ещё одной бригадой эти заявки не назначить: посмотрите причины в «Неназначенных»',
      tone: 'warning',
      proposalId,
      helps: false,
    };
  }
  const skills = skillsText(candidate.skills);
  const transport = transportOn(candidate.transport);
  let text = `Чтобы назначить ${closed} ${plural(closed, PL_UNASSIGNED_ACC)}, не хватает +1 инженера${skills}`;
  if (transport) text += skills ? ` и ${transport}` : ` ${transport}`;
  if (still > 0) {
    text += `; ещё ${countOf(still, PL_REQUEST)} ${plural(still, ['останется', 'останутся', 'останутся'])} без исполнителя`;
  }
  return { text, tone: 'info', proposalId, helps: true };
}

export interface NewEngineerErrors {
  name?: string;
  skills?: string;
  shift?: string;
}

export function validateNewEngineer(engineer: Omit<NewEngineer, 'key'>): NewEngineerErrors {
  const errors: NewEngineerErrors = {};
  if (!engineer.name.trim()) errors.name = 'Укажите имя';
  if (engineer.skills.length === 0) errors.skills = 'Выберите хотя бы один навык';
  const start = toMin(engineer.shiftStart);
  const end = toMin(engineer.shiftEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    errors.shift = 'Начало смены должно быть раньше окончания';
  }
  return errors;
}

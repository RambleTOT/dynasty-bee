/**
 * Ручное переназначение (DS-08, FRONTEND_SPEC §6.7): кандидаты, сведение `checks` к трём ограничениям,
 * метки и подписи кандидатов, позиция в маршруте, чипы-последствия.
 * Ответ `reassign/check` — объект «без схемы» (§5.2): читаем только безопасно.
 */
import type { ReassignCheckResponse } from '@/api/types';
import { transportNeed } from '@/lib/explainTexts';
import { formatDelta, formatKm } from '@/lib/format';
import type { LatLng } from '@/lib/map';
import type { StatusTone } from '@/lib/statuses';
import { toMin } from '@/lib/time';
import type { ConstraintRow } from './constraints';
import type { DayEngineer, DayModel, DayRequest } from './dayModel';

export type ConstraintLabel = ConstraintRow['label'];

/** Сколько ближайших подходящих бригад проверяем сразу, параллельно (§6.7). */
export const CHECK_LIMIT = 5;

// ---------- кандидаты ----------

/** Не прошла фильтр на фронте: по навыку или по транспорту. */
export type CandidateFilter = 'skill' | 'transport';

export interface ReassignCandidate {
  engineer: DayEngineer;
  filter: CandidateFilter | null;
  /** Прямое расстояние до заявки от ближайшей точки маршрута бригады или её старта, км. */
  distanceKm: number | null;
  /** Входит в «до 5 ближайших»: `check` — сразу, параллельно. Остальных проверяем при выборе. */
  checkNow: boolean;
}

const EARTH_KM = 6371;
const rad = (deg: number) => (deg * Math.PI) / 180;

export function haversineKm([lat1, lon1]: LatLng, [lat2, lon2]: LatLng): number {
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Бригада на смене: в составе дня, не снята и не закончила смену. */
export function onShift(engineer: DayEngineer): boolean {
  return (
    engineer.available &&
    engineer.shiftStatus !== 'unavailable' &&
    engineer.shiftStatus !== 'finished'
  );
}

function filterOf(engineer: DayEngineer, request: DayRequest): CandidateFilter | null {
  if (!engineer.skills.includes(request.skill)) return 'skill';
  if (request.requiredTransport && engineer.transport !== request.requiredTransport)
    return 'transport';
  return null;
}

function distanceTo(
  engineer: DayEngineer,
  request: DayRequest,
  model: Pick<DayModel, 'routeByEngineer'>,
): number | null {
  if (!request.point) return null;
  const points = [
    engineer.start,
    ...(model.routeByEngineer.get(engineer.id)?.visits ?? [])
      .filter((v) => v.requestId !== request.id)
      .map((v) => v.point),
  ].filter((p): p is LatLng => Boolean(p));
  if (points.length === 0) return null;
  return Math.min(...points.map((p) => haversineKm(p, request.point as LatLng)));
}

const byDistance = (a: ReassignCandidate, b: ReassignCandidate) =>
  (a.distanceKm ?? Number.POSITIVE_INFINITY) - (b.distanceKm ?? Number.POSITIVE_INFINITY);

/**
 * Кандидаты — бригады на смене, кроме текущей. Прошедшие фильтр по навыку и транспорту — по близости
 * к заявке, первые `limit` проверяем сразу; не прошедшие — внизу списка с меткой, без запроса к API.
 */
export function reassignCandidates(
  model: Pick<DayModel, 'engineers' | 'routeByEngineer'>,
  request: DayRequest,
  limit = CHECK_LIMIT,
): ReassignCandidate[] {
  const all = model.engineers
    .filter((e) => e.id !== request.engineerId && onShift(e))
    .map((engineer) => ({
      engineer,
      filter: filterOf(engineer, request),
      distanceKm: distanceTo(engineer, request, model),
      checkNow: false,
    }));
  const passed = all.filter((c) => !c.filter).sort(byDistance);
  const filtered = all.filter((c) => c.filter).sort(byDistance);
  passed.forEach((c, index) => {
    c.checkNow = index < limit;
  });
  return [...passed, ...filtered];
}

// ---------- ответ check → три ограничения ----------

export type CheckVerdict = 'ok' | 'window' | 'violation';

export interface CheckRow {
  label: ConstraintLabel;
  text: string;
}

export interface CheckSummary {
  feasible: boolean;
  verdict: CheckVerdict;
  /** Нарушенные ограничения — по строке на «Квалификация», «Время», «Ресурс». */
  violations: CheckRow[];
  newStart: string | null;
  deltaKm: number;
  /** Заявки, которые уйдут в просрочку. */
  lateIds: string[];
  /** Сдвиг визитов новой бригады, мин (`shifted_visits`) — для черновика на таймлайне. */
  shifted: { orderId: string; deltaMin: number }[];
  /** `engineer_idle_today` бэка (§13.2): бригада сегодня не работает; нет поля — `null`. */
  idleToday: boolean | null;
}

const LABEL_ORDER: readonly ConstraintLabel[] = ['Квалификация', 'Время', 'Ресурс'];

/** Ключи `checks` → три ограничения ТЗ (§6.7); `equipment` — тоже «Ресурс» (docs/API_NOTES.md). */
const CHECK_LABEL: Record<string, ConstraintLabel> = {
  skill: 'Квалификация',
  skills: 'Квалификация',
  qualification: 'Квалификация',
  skill_level: 'Квалификация',
  time: 'Время',
  window: 'Время',
  shift: 'Время',
  transport: 'Ресурс',
  resource: 'Ресурс',
  equipment: 'Ресурс',
};

export function checkLabel(key: string): ConstraintLabel {
  const known = CHECK_LABEL[key];
  if (known) return known;
  if (/skill|qualif/i.test(key)) return 'Квалификация';
  if (/time|window|shift|late|slot/i.test(key)) return 'Время';
  // незнакомый ключ — ресурс бригады: транспорт, оборудование и прочее [Д]
  return 'Ресурс';
}

interface CheckValue {
  ok: boolean;
  text: string;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
const str = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

function readCheck(value: unknown): CheckValue | null {
  if (typeof value === 'boolean') return { ok: value, text: '' };
  if (!isObject(value)) return null;
  const ok =
    typeof value.ok === 'boolean'
      ? value.ok
      : typeof value.passed === 'boolean'
        ? value.passed
        : null;
  if (ok === null) return null;
  return { ok, text: str(value.text) || str(value.reason) || str(value.message) };
}

/** «Нужен автомобиль.» → «нужен автомобиль»: текст идёт после «Ресурс: ». Аббревиатуры не трогаем. */
function asTail(text: string): string {
  const clean = text.replace(/[.\s]+$/, '');
  const [first, second] = clean;
  if (first && second && first !== first.toLowerCase() && second === second.toLowerCase()) {
    return first.toLowerCase() + clean.slice(1);
  }
  return clean;
}

function outsideWindow(start: string, request: DayRequest): boolean {
  const s = toMin(start);
  return Number.isFinite(s) && (s < toMin(request.windowStart) || s > toMin(request.windowEnd));
}

function templateText(
  label: ConstraintLabel,
  key: string,
  request: DayRequest,
  newStart: string | null,
) {
  switch (label) {
    case 'Квалификация':
      return `нет навыка «${request.skillLabel}»`;
    case 'Время':
      return newStart && outsideWindow(newStart, request)
        ? `начало ${newStart} вне окна ${request.windowShort}`
        : `не помещается в окно ${request.windowShort} и смену`;
    case 'Ресурс':
      if (/equip|kit/i.test(key)) return 'нет нужного оборудования';
      return request.requiredTransport
        ? `нужен ${transportNeed(request.requiredTransport)}`
        : 'не хватает ресурса';
  }
}

function shiftedOf(list: unknown): { orderId: string; deltaMin: number }[] {
  if (!Array.isArray(list)) return [];
  return list.flatMap((item) => {
    if (!isObject(item)) return [];
    const id = item.order_id ?? item.request_id;
    const delta = Number(item.delta_min);
    return (typeof id === 'string' || typeof id === 'number') && Number.isFinite(delta) && delta !== 0
      ? [{ orderId: String(id), deltaMin: delta }]
      : [];
  });
}

function lateIdsOf(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const ids = list
    .map((item) => (isObject(item) ? (item.order_id ?? item.request_id ?? item.id) : item))
    .filter((id): id is string | number => typeof id === 'string' || typeof id === 'number')
    .map(String)
    .filter(Boolean);
  return [...new Set(ids)];
}

/**
 * Ответ `check` → вердикт и нарушения по трём ограничениям. Текст — из значения, иначе шаблон
 * («Время: начало 16:40 вне окна 14–16»). Нарушено только время — «Вне окна», иначе «Нарушение».
 */
export function summarizeCheck(response: ReassignCheckResponse, request: DayRequest): CheckSummary {
  const newStart = str(response.new_start) || null;
  // поля ещё нет в схеме (§13.2) — читаем безопасно
  const idle = (response as unknown as Record<string, unknown>).engineer_idle_today;
  const failed = new Map<ConstraintLabel, string[]>();
  for (const [key, value] of Object.entries(isObject(response.checks) ? response.checks : {})) {
    const check = readCheck(value);
    if (!check || check.ok) continue;
    const label = checkLabel(key);
    const text = check.text ? asTail(check.text) : templateText(label, key, request, newStart);
    const texts = failed.get(label) ?? [];
    if (!texts.includes(text)) texts.push(text);
    failed.set(label, texts);
  }
  const feasible = response.feasible === true;
  const violations = feasible
    ? []
    : LABEL_ORDER.filter((label) => failed.has(label)).map((label) => ({
        label,
        text: (failed.get(label) ?? []).join('; '),
      }));
  let verdict: CheckVerdict = 'ok';
  if (!feasible) {
    verdict = violations.length === 1 && violations[0].label === 'Время' ? 'window' : 'violation';
  }
  const deltaKm = Number(response.delta_km);
  return {
    feasible,
    verdict,
    violations,
    newStart,
    deltaKm: Number.isFinite(deltaKm) ? deltaKm : 0,
    lateIds: lateIdsOf(response.late_visits),
    shifted: shiftedOf(response.shifted_visits),
    idleToday: typeof idle === 'boolean' ? idle : null,
  };
}

// ---------- метка и подпись кандидата ----------

export interface CandidateBadge {
  text: string;
  tone: StatusTone;
  ok: boolean;
}

const VERDICT_BADGE: Record<CheckVerdict, CandidateBadge> = {
  ok: { text: 'Подходит', tone: 'success', ok: true },
  window: { text: 'Вне окна', tone: 'danger', ok: false },
  violation: { text: 'Нарушение', tone: 'danger', ok: false },
};

export function filterLabel(filter: CandidateFilter, request: DayRequest): string {
  if (filter === 'skill') return 'Нет навыка';
  return !request.requiredTransport || request.requiredTransport === 'car'
    ? 'Нет авто'
    : 'Нет транспорта';
}

/**
 * Метка кандидата. У отсеянного фронтом метка не меняется и после проверки (§8.2, таблица макета, п. 7);
 * у остальных — по ответу `check`; нет ответа — метки нет.
 */
export function candidateBadge(
  candidate: Pick<ReassignCandidate, 'filter'>,
  request: DayRequest,
  summary: CheckSummary | null,
): CandidateBadge | null {
  if (candidate.filter)
    return { text: filterLabel(candidate.filter, request), tone: 'danger', ok: false };
  return summary ? VERDICT_BADGE[summary.verdict] : null;
}

/** Транспорт в подписи кандидата; автомобиль не пишем — как в макете. */
const TRANSPORT_WORD: Record<string, string> = {
  walk: 'пешком',
  bike: 'на велосипеде',
  public_transport: 'на общ. транспорте',
};

/**
 * Подпись кандидата (§6.7, §8.2 п. 23): «свободен 14:20 · 2,8 км», «занят до 16:10»,
 * «пешком · начало 16:40», без проверки — «пешком · 4,1 км». `free` — когда бригада освобождается
 * перед вставкой: окончание предыдущей заявки маршрута или начало смены.
 */
export function candidateInfo(
  candidate: Pick<ReassignCandidate, 'engineer' | 'distanceKm'>,
  check: { summary: CheckSummary; free: string | null } | null,
): string {
  const parts: string[] = [];
  const word = TRANSPORT_WORD[candidate.engineer.transport];
  if (word) parts.push(word);
  const km = candidate.distanceKm != null ? `${formatKm(candidate.distanceKm)} км` : null;
  if (!check) {
    if (km) parts.push(km);
    return parts.join(' · ');
  }
  const { summary, free } = check;
  const start = summary.newStart ? `начало ${summary.newStart}` : null;
  if (summary.verdict === 'ok') {
    parts.push(...[free ? `свободен ${free}` : start, km].filter((p): p is string => Boolean(p)));
  } else if (summary.verdict === 'window') {
    const busy = free ? `занят до ${free}` : start;
    if (busy) parts.push(busy);
  } else if (start) {
    parts.push(start);
  }
  return parts.join(' · ');
}

// ---------- позиция в маршруте ----------

export interface RouteStop {
  requestId: string;
  /** «№305865102». */
  number: string;
  start: string;
  /** Окончание: факт, если есть. */
  end: string;
  /** Выполнена, в работе или бригада уже в пути — вставить перед ней нельзя. */
  locked: boolean;
}

const LOCKED_STATUSES = new Set(['done', 'in_progress', 'en_route']);

/** Точки маршрута бригады по порядку, без самой переназначаемой заявки. */
export function routeStops(
  model: Pick<DayModel, 'routeByEngineer' | 'requestById'>,
  engineerId: string,
  exceptRequestId?: string,
): RouteStop[] {
  return (model.routeByEngineer.get(engineerId)?.visits ?? [])
    .filter((v) => v.requestId !== exceptRequestId)
    .map((v) => ({
      requestId: v.requestId,
      number: model.requestById.get(v.requestId)?.number ?? `№${v.requestId}`,
      start: v.actualStart ?? v.start,
      end: v.actualEnd ?? v.end,
      locked: v.frozen || LOCKED_STATUSES.has(String(v.status)),
    }));
}

/** Первая допустимая позиция: сразу после последней закреплённой точки. */
export function minPosition(stops: readonly RouteStop[]): number {
  let min = 0;
  stops.forEach((stop, index) => {
    if (stop.locked) min = index + 1;
  });
  return min;
}

/**
 * Позиция, которую выбрал бэк (`position: null` — «лучшая»): точки, закончившиеся до нового начала,
 * идут перед заявкой. Нет `new_start` — неизвестно.
 */
export function inferPosition(stops: readonly RouteStop[], newStart: string | null): number | null {
  const start = newStart ? toMin(newStart) : Number.NaN;
  if (!Number.isFinite(start)) return null;
  let position = 0;
  while (position < stops.length && toMin(stops[position].end) <= start) position += 1;
  return Math.max(position, minPosition(stops));
}

/** Когда бригада свободна перед вставкой: окончание предыдущей точки или начало смены. */
export function freeAt(
  stops: readonly RouteStop[],
  position: number | null,
  shiftStart: string,
): string | null {
  if (position == null) return null;
  if (position <= 0) return shiftStart || null;
  return stops[Math.min(position, stops.length) - 1]?.end ?? null;
}

export interface PositionOption {
  value: string;
  label: string;
}

/**
 * «Позиция в маршруте»: «В начало маршрута» и «После №… » по точкам (position = номер точки + 1).
 * У выбранной позиции — начало заявки из ответа `check`: «После №305865102 · начало 14:40».
 */
export function positionOptions(
  stops: readonly RouteStop[],
  selected: number | null,
  newStart: string | null,
): PositionOption[] {
  const min = minPosition(stops);
  const options = [
    { position: 0, label: 'В начало маршрута' },
    ...stops.map((stop, index) => ({ position: index + 1, label: `После ${stop.number}` })),
  ].filter((o) => o.position >= min);
  return options.map(({ position, label }) => ({
    value: String(position),
    label: position === selected && newStart ? `${label} · начало ${newStart}` : label,
  }));
}

// ---------- последствия ----------

/** «Инженеров ±N»: −1, если маршрут «откуда» опустеет; +1, если маршрут «куда» был пуст (§6.7). */
export function engineersDelta(
  model: Pick<DayModel, 'routeByEngineer'>,
  request: Pick<DayRequest, 'id' | 'engineerId'>,
  toEngineerId: string,
): number {
  const fromId = request.engineerId;
  const fromVisits = fromId ? (model.routeByEngineer.get(fromId)?.visits ?? []) : [];
  const leavesEmpty =
    Boolean(fromId) &&
    fromId !== toEngineerId &&
    fromVisits.every((v) => v.requestId === request.id) &&
    fromVisits.length > 0;
  const toEmpty = (model.routeByEngineer.get(toEngineerId)?.visits.length ?? 0) === 0;
  return (leavesEmpty ? -1 : 0) + (toEmpty ? 1 : 0);
}

const LATE_SHOWN = 2;

/** Чипы: «Уйдут в просрочку: №… / нет», «Пробег +2,8 км», «Инженеров 0». */
export function consequenceChips(
  summary: Pick<CheckSummary, 'lateIds' | 'deltaKm'>,
  engineers: number,
  numberOf: (requestId: string) => string,
): string[] {
  const { lateIds } = summary;
  const rest = lateIds.length - LATE_SHOWN;
  const late = lateIds.length
    ? lateIds.slice(0, LATE_SHOWN).map(numberOf).join(', ') + (rest > 0 ? ` и ещё ${rest}` : '')
    : 'нет';
  return [
    `Уйдут в просрочку: ${late}`,
    `Пробег ${formatDelta(summary.deltaKm, 'km')}`,
    `Инженеров ${formatDelta(engineers, 'count')}`,
  ];
}

/**
 * Бригада сегодня не работает (D-38, §13.2): вызов «с выходного» — эскалация, решает диспетчер.
 * Бэк прислал `engineer_idle_today` — берём его, иначе — у бригады нет заявок в текущем плане.
 */
export function idleToday(
  engineer: Pick<DayEngineer, 'used'>,
  summary: Pick<CheckSummary, 'idleToday'> | null,
): boolean {
  return summary?.idleToday ?? !engineer.used;
}

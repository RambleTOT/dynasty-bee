/**
 * Модель экрана инженера из `GET /engineers/me/day` (FRONTEND_SPEC §9): визиты по порядку, текущая
 * заявка (D-30), «Далее по маршруту» и «Завершённые», состояние страницы (§9.1), баннеры (E-09),
 * итоги смены (E-10). Ответ «без схемы»: поля читаем безопасно, где поля нет — запасной путь §5.4.
 */
import type {
  EngineerBanner,
  EngineerMeDay,
  EngineerShiftTotals,
  EngineerVisit,
  ShiftStatus,
} from '@/api/types';
import { colorForPosition } from '@/lib/colors';
import { engineerLabel } from '@/lib/dictionaries';
import {
  fullAddress,
  shortAddress,
  visitTitle,
  windowFull,
  windowShort,
} from '@/lib/engineerLabels';
import { timeOfIso } from '@/lib/format';
import { isValidLatLng } from '@/lib/map';
import {
  CLOSED_STATUSES,
  isRequestStatus,
  isTransport,
  knownFlags,
  PENDING_STATUSES,
  type Flag,
  type RequestStatus,
  type Transport,
} from '@/lib/statuses';

export interface EngineerVisitModel {
  id: string;
  sequence: number;
  status: RequestStatus;
  flags: Flag[];
  /** `type_hd ?? type_bk ?? подпись по навыку`. */
  title: string;
  typeBk: string | null;
  /** Для карточки: без «Город Москва, », с квартирой. '' — адреса нет. */
  address: string;
  /** Для строк: без города и квартиры. */
  addressShort: string;
  district: string | null;
  /** «14–16». */
  windowShort: string;
  /** «14:00–16:00». */
  windowFull: string;
  /** Плановые приезд и начало, 'HH:MM'. */
  arrival: string | null;
  start: string | null;
  durationMin: number | null;
  legKm: number | null;
  gigabit: boolean;
  technology: string | null;
  whyYou: string | null;
  /** Факт ⏳ 8.6. */
  actualStart: string | null;
  actualEnd: string | null;
  /** Оборудование ⏳ 8.8: «вид × количество» через запятую; поля нет — null. */
  equipment: string | null;
  /** Точка заявки: в схеме визита координат нет, но бэк их отдаёт — запасной путь для карты. */
  lat: number | null;
  lon: number | null;
}

export type StartKind = 'office' | 'home';

export interface EngineerModel {
  id: string;
  /** «Бригада E00», если имени нет (§6.8). */
  name: string;
  /** Транспорт по справочнику. */
  transport: Transport | null;
  actualTransport: Transport | null;
  shiftStart: string | null;
  shiftEnd: string | null;
  shiftStatus: ShiftStatus;
  availableUntil: string | null;
  start: { kind: StartKind | null; address: string } | null;
  /** Номер цвета маршрута 1…12: по `color_index` ⏳ 8.9, иначе `--route-1` (§10.2). */
  routeColor: number;
}

export interface EngineerBannerModel {
  /** Ключ «просмотрено» в localStorage: `seen_banner_<at>_<type>`. */
  key: string;
  type: string;
  text: string;
  at: string | null;
  requestId: string | null;
}

export interface EngineerDayModel {
  date: string | null;
  /** Поля нет — считаем, что план опубликован: иначе бэк не отдал бы визиты. */
  planPublished: boolean;
  /** Часы дня ⏳ §1. */
  clock: string | null;
  engineer: EngineerModel;
  /** Всего заявок дня: `summary.total`, иначе число визитов. */
  total: number;
  /** «первая в …»: `summary.first_start`, иначе приезд на первую заявку. */
  firstStart: string | null;
  activeRequestId: string | null;
  /** По `sequence`. */
  visits: EngineerVisitModel[];
  banners: EngineerBannerModel[];
  totals: EngineerShiftTotals | null;
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null;

const str = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const time = (value: unknown): string | null => str(timeOfIso(str(value)));

const transportOf = (value: unknown): Transport | null => (isTransport(value) ? value : null);

const SHIFT_STATUSES: readonly ShiftStatus[] = [
  'not_started',
  'on_shift',
  'unavailable',
  'finished',
];

const isShiftStatus = (value: unknown): value is ShiftStatus =>
  typeof value === 'string' && (SHIFT_STATUSES as readonly string[]).includes(value);

/** Оборудование `{вид: количество}` → «роутер, кабель × 2». Подписей видов бэк пока не прислал (⏳ 8.8). */
function equipmentLabel(value: unknown): string | null {
  if (!isObject(value)) return null;
  const items = Object.entries(value)
    .filter(([kind, count]) => kind.trim() !== '' && (num(count) ?? 0) > 0)
    .map(([kind, count]) => (count === 1 ? kind : `${kind} × ${count}`));
  return items.length ? items.join(', ') : null;
}

/** Поля визита, которых нет в схеме, но бэк их отдаёт или обещал (⏳ 8.6, 8.8). */
type VisitWire = EngineerVisit & { required_skill?: unknown; lat?: unknown; lon?: unknown };

function toVisit(raw: VisitWire): EngineerVisitModel {
  const address = str(raw.address);
  const point = isValidLatLng(raw.lat, raw.lon);
  return {
    id: String(raw.request_id),
    sequence: num(raw.sequence) ?? 0,
    status: raw.status as RequestStatus,
    flags: knownFlags(raw.flags),
    title: visitTitle({
      type_hd: str(raw.type_hd),
      type_bk: str(raw.type_bk),
      required_skill: str(raw.required_skill),
    }),
    typeBk: str(raw.type_bk),
    address: fullAddress(address),
    addressShort: shortAddress(address),
    district: str(raw.district),
    windowShort: windowShort(raw.window),
    windowFull: windowFull(raw.window),
    arrival: time(raw.arrival),
    start: time(raw.start),
    durationMin: num(raw.duration_minutes),
    legKm: num(raw.leg_km),
    gigabit: raw.gigabit === true,
    technology: str(raw.technology),
    whyYou: str(raw.why_you),
    actualStart: time(raw.actual_start),
    actualEnd: time(raw.actual_end),
    equipment: equipmentLabel(raw.equipment),
    lat: point ? (raw.lat as number) : null,
    lon: point ? (raw.lon as number) : null,
  };
}

function toBanner(raw: EngineerBanner): EngineerBannerModel | null {
  const text = str(raw?.text);
  if (!text) return null;
  const type = str(raw.type) ?? '';
  const at = str(raw.at);
  return { key: `seen_banner_${at ?? ''}_${type}`, type, text, at, requestId: str(raw.request_id) };
}

const bySequence = (a: EngineerVisitModel, b: EngineerVisitModel) => a.sequence - b.sequence;

export function toEngineerDay(raw: EngineerMeDay): EngineerDayModel {
  const visits = (Array.isArray(raw?.visits) ? raw.visits : [])
    // незнакомый статус не показываем: у него нет подписи и места в списке
    .filter((visit) => isObject(visit) && isRequestStatus(visit.status))
    .map(toVisit)
    .sort(bySequence);

  const engineer: Partial<EngineerMeDay['engineer']> = isObject(raw?.engineer) ? raw.engineer : {};
  const id = str(engineer.id) ?? '';
  const name = str(engineer.name);
  const start = isObject(engineer.start) ? engineer.start : null;
  const kind = str(start?.kind);
  const colorIndex = num(engineer.color_index);

  // shift_status есть у EngineerOut; если бэк его не прислал — по визитам: что-то уже тронуто → смена идёт
  const shiftStatus: ShiftStatus = isShiftStatus(engineer.shift_status)
    ? engineer.shift_status
    : visits.some((visit) => visit.status !== 'planned')
      ? 'on_shift'
      : 'not_started';

  const summary: Json = isObject(raw?.summary) ? raw.summary : {};
  const first = visits[0];

  return {
    date: str(raw?.date),
    planPublished: raw?.plan_published !== false,
    clock: str(raw?.clock),
    engineer: {
      id,
      // ни имени, ни id — пусто: шапка возьмёт имя из профиля
      name: name || id ? engineerLabel(name, id) : '',
      transport: transportOf(engineer.transport),
      actualTransport: transportOf(engineer.actual_transport),
      shiftStart: time(engineer.shift_start),
      shiftEnd: time(engineer.shift_end),
      shiftStatus,
      availableUntil: time(engineer.available_until),
      start:
        start && (kind || str(start.address))
          ? {
              kind: kind === 'office' || kind === 'home' ? kind : null,
              address: fullAddress(str(start.address)),
            }
          : null,
      routeColor:
        colorIndex !== null && Number.isInteger(colorIndex) && colorIndex >= 0
          ? colorForPosition(colorIndex).index
          : 1,
    },
    total: num(summary.total) ?? visits.length,
    firstStart: time(summary.first_start) ?? first?.arrival ?? first?.start ?? null,
    activeRequestId: str(raw?.active_request_id),
    visits,
    banners: (Array.isArray(raw?.banners) ? raw.banners : [])
      .map(toBanner)
      .filter((banner): banner is EngineerBannerModel => banner !== null),
    totals: isObject(raw?.shift_totals) ? raw.shift_totals : null,
  };
}

// --- статусы визита ---

const ACTIVE_STATUSES: readonly RequestStatus[] = ['en_route', 'in_progress'];

/** В пути или в работе. */
export const isActiveStatus = (status: RequestStatus) => ACTIVE_STATUSES.includes(status);
/** Ждёт решения диспетчера: «Отменяется», «Переносится». */
export const isPendingStatus = (status: RequestStatus) => PENDING_STATUSES.includes(status);
/** Выполнена, отменена или перенесена. */
export const isClosedStatus = (status: RequestStatus) => CLOSED_STATUSES.includes(status);

/**
 * Решение диспетчера по «Прервать» (бэк баннера об этом не шлёт): заявка ждала решения, а теперь
 * её нет в дне или она закрыта — подтверждено; снова в работе или в плане — диспетчер вернул.
 */
export interface PendingOutcome {
  id: string;
  kind: 'cancel_confirmed' | 'reschedule_confirmed' | 'returned';
}

export function pendingOutcomes(
  before: readonly Pick<EngineerVisitModel, 'id' | 'status'>[],
  after: readonly Pick<EngineerVisitModel, 'id' | 'status'>[],
): PendingOutcome[] {
  const now = new Map(after.map((visit) => [visit.id, visit.status]));
  return before.flatMap((visit): PendingOutcome[] => {
    if (!isPendingStatus(visit.status)) return [];
    const status = now.get(visit.id);
    if (status && isPendingStatus(status)) return [];
    if (!status || isClosedStatus(status)) {
      const reschedule = visit.status === 'reschedule_pending' || status === 'rescheduled';
      return [{ id: visit.id, kind: reschedule ? 'reschedule_confirmed' : 'cancel_confirmed' }];
    }
    return [{ id: visit.id, kind: 'returned' }];
  });
}

type VisitsOf = Pick<EngineerDayModel, 'visits' | 'activeRequestId'>;

/**
 * Текущая заявка (D-30): `active_request_id`, иначе первая по `sequence` в статусе `planned`.
 * «Отменяется» и «Переносится» текущими не бывают. [Д] Заявка в пути или в работе без
 * `active_request_id` — всё равно текущая: начать другую бэк не даст.
 */
export function currentVisit(day: VisitsOf): EngineerVisitModel | null {
  const active = day.activeRequestId
    ? day.visits.find((visit) => visit.id === day.activeRequestId)
    : undefined;
  if (active && (active.status === 'planned' || isActiveStatus(active.status))) return active;
  return (
    day.visits.find((visit) => isActiveStatus(visit.status)) ??
    day.visits.find((visit) => visit.status === 'planned') ??
    null
  );
}

export interface RouteGroups {
  current: EngineerVisitModel | null;
  /** «Далее по маршруту», первыми — ждущие решения диспетчера (Р-1). */
  waiting: EngineerVisitModel[];
  /** «Далее по маршруту»: остальные незакрытые по `sequence`. */
  upcoming: EngineerVisitModel[];
  /** «Завершённые»: выполнена, отменена, перенесена. */
  completed: EngineerVisitModel[];
}

export function routeGroups(day: VisitsOf): RouteGroups {
  const current = currentVisit(day);
  const rest = day.visits.filter((visit) => visit !== current);
  return {
    current,
    waiting: rest.filter((visit) => isPendingStatus(visit.status)),
    upcoming: rest.filter((visit) => visit.status === 'planned' || isActiveStatus(visit.status)),
    completed: rest.filter((visit) => isClosedStatus(visit.status)),
  };
}

/** Заявки в статусе «Запланирована» — их вернут диспетчеру при «Завершить смену». */
export const plannedLeft = (day: Pick<EngineerDayModel, 'visits'>) =>
  day.visits.filter((visit) => visit.status === 'planned').length;

/** Есть заявка в пути или в работе: «Завершить смену» неактивна (D-31). */
export const hasActiveVisit = (day: Pick<EngineerDayModel, 'visits'>) =>
  day.visits.some((visit) => isActiveStatus(visit.status));

// --- состояние страницы (§9.1) ---

export type EngineerPageState =
  /** План ещё не опубликован. */
  | 'unpublished'
  /** Заявок на сегодня нет. */
  | 'empty'
  /** E-01: смена не начата. */
  | 'preview'
  /** E-03 / E-04: на смене. */
  | 'shift'
  /** E-03 без кнопок: сообщил «Не могу работать». */
  | 'unavailable'
  /** E-10. */
  | 'finished';

export function pageState(day: EngineerDayModel): EngineerPageState {
  if (!day.planPublished) return 'unpublished';
  const status = day.engineer.shiftStatus;
  if (status === 'finished') return 'finished';
  if (day.visits.length === 0) return 'empty';
  if (status === 'not_started') return 'preview';
  if (status === 'unavailable') return 'unavailable';
  return 'shift';
}

// --- баннер «План изменён» (E-09) ---

/** Самый свежий непросмотренный баннер: позже по `at`, при равенстве — последний в списке. */
export function latestBanner(
  banners: readonly EngineerBannerModel[],
  isSeen: (key: string) => boolean,
): EngineerBannerModel | null {
  let latest: EngineerBannerModel | null = null;
  for (const banner of banners) {
    if (isSeen(banner.key)) continue;
    if (!latest || (banner.at ?? '') >= (latest.at ?? '')) latest = banner;
  }
  return latest;
}

// --- итоги смены (E-10) ---

export interface ShiftSummaryModel {
  done: number;
  total: number;
  /** null — «—» (нет `shift_totals`). */
  startedInWindow: number | null;
  km: number | null;
  interrupted: number;
  minutesTravel: number | null;
  minutesWork: number | null;
  minutesWait: number | null;
  /** Факт начала и конца смены ⏳ 8.7. */
  startedAt: string | null;
  endedAt: string | null;
}

/** Прервано по визитам (без `shift_totals`): ждут решения диспетчера, отменены или перенесены. */
const INTERRUPTED: readonly RequestStatus[] = [...PENDING_STATUSES, 'cancelled', 'rescheduled'];

export function shiftSummary(day: EngineerDayModel): ShiftSummaryModel {
  const t = day.totals;
  const doneByVisits = day.visits.filter((visit) => visit.status === 'done').length;
  const interruptedByVisits = day.visits.filter((visit) =>
    INTERRUPTED.includes(visit.status),
  ).length;
  return {
    done: num(t?.done) ?? doneByVisits,
    total: num(t?.total) ?? day.total,
    startedInWindow: num(t?.started_in_window),
    km: num(t?.km),
    interrupted: num(t?.interrupted) ?? interruptedByVisits,
    minutesTravel: num(t?.minutes_travel),
    minutesWork: num(t?.minutes_work),
    minutesWait: num(t?.minutes_wait),
    startedAt: time(t?.started_at),
    endedAt: time(t?.ended_at),
  };
}

// --- оптимистичный статус (§9.3) ---

/**
 * Статус визита в кэше `engineerDay` до ответа бэка: кнопка статуса откликается сразу.
 * Ошибка (409 `ILLEGAL_TRANSITION`) — откат к прежнему снимку кэша.
 */
export function withVisitStatus(
  raw: EngineerMeDay,
  requestId: string,
  status: RequestStatus,
): EngineerMeDay {
  const visits = (raw.visits ?? []).map((visit) =>
    visit.request_id === requestId ? { ...visit, status } : visit,
  );
  const activeRequestId = isActiveStatus(status)
    ? requestId
    : raw.active_request_id === requestId
      ? null
      : raw.active_request_id;
  return { ...raw, visits, active_request_id: activeRequestId };
}

/** Статус заявки после «Прервать» (8.2): перенос — «Переносится», иначе — «Отменяется». */
export const statusAfterFail = (reason: unknown): RequestStatus =>
  reason === 'client_reschedule' ? 'reschedule_pending' : 'cancel_pending';

/**
 * «Прервать» (8.2) поверх ответа бэка. Бэк меняет статус только у заявки, а `/engineers/me/day`
 * берёт статус из точки плана — там заявка остаётся «В пути» и снова становится текущей
 * (docs/BACKEND_REQUESTS.md). Пока бэк отдаёт `planned` / `en_route` / `in_progress`, держим статус
 * после «Прервать». Как только он сам прислал другой статус — `resolved`, решает бэк.
 */
export function withFailedVisits(
  raw: EngineerMeDay,
  failed: ReadonlyMap<string, RequestStatus>,
): { day: EngineerMeDay; resolved: string[] } {
  if (failed.size === 0) return { day: raw, resolved: [] };
  const resolved: string[] = [];
  let day = raw;
  for (const [requestId, status] of failed) {
    const visit = (raw.visits ?? []).find((v) => v.request_id === requestId);
    if (!visit || !(visit.status === 'planned' || isActiveStatus(visit.status as RequestStatus))) {
      resolved.push(requestId);
      continue;
    }
    day = withVisitStatus(day, requestId, status);
  }
  return { day, resolved };
}

/**
 * День из ответа действия (`EngineerActionOut.day`) поверх дня в кэше. В схеме это
 * `EngineerDayResponse` — без `date`, `plan_published`, `shift_totals`: чего в ответе нет, берём
 * из прежнего дня, чтобы экран не мигал до следующего опроса.
 */
export function mergeDay(previous: EngineerMeDay | undefined, next: EngineerMeDay): EngineerMeDay {
  if (!previous) return next;
  return {
    ...previous,
    ...next,
    engineer: { ...previous.engineer, ...next.engineer },
    summary: { ...previous.summary, ...next.summary },
  };
}

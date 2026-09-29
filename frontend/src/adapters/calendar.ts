/**
 * DS-01 «Календарь заявок»: ответ `GET /calendar` → модель сетки месяца (FRONTEND_SPEC §8.2 DS-01).
 *
 * - Полоса и подсказка — по статусам ТЗ (D-29), не по группам макета: сегменты по `by_status`
 *   в порядке `CALENDAR_BAR_STATUSES`, без `cancelled` / `rescheduled` и без флагов.
 * - «N просрочена» — из `flags.late`, только если поле пришло и больше нуля (бэк пока считает
 *   во `flags` только `urgent`).
 * - Бейдж «CSV» — если в `sources` есть `csv` или `demo`.
 * - Дней без заявок бэк не присылает — такой день пустой («—»).
 */
import type { CalendarDay, CalendarResponse } from '@/api/types';
import { regionLabel } from '@/lib/dictionaries';
import { countOf, formatDayTitle, formatInt, plural, PL_REGION, PL_REQUEST } from '@/lib/format';
import {
  CALENDAR_BAR_STATUSES,
  FLAG_LABEL,
  isRequestStatus,
  REGIONS,
  REQUEST_STATUS_LABEL,
  REQUEST_STATUS_TONE,
  type RequestStatus,
  type StatusTone,
} from '@/lib/statuses';
import { isoWeekday, monthGrid } from '@/lib/time';

export interface CalendarSegment {
  status: RequestStatus;
  count: number;
  tone: StatusTone;
}

export interface CalendarTipRow {
  /** Статус заявки или `late` — строка флага «Просрочена». */
  key: RequestStatus | 'late';
  label: string;
  count: number;
  tone: StatusTone;
}

/** Строка региона в подсказке «Все регионы»: где именно заявки и неназначенные. */
export interface CalendarRegionRow {
  regionId: string;
  label: string;
  count: number;
  unassigned: number;
}

/** Подсказка по наведению: «Пн, 29 сентября · 66 заявок» и строка на каждый ненулевой статус. */
export interface CalendarTip {
  title: string;
  rows: CalendarTipRow[];
  /** «Все регионы»: по строке на регион с заявками. */
  regions: CalendarRegionRow[];
}

export interface CalendarCell {
  /** 'YYYY-MM-DD'. */
  date: string;
  day: number;
  /** 1 — понедельник … 7 — воскресенье. */
  weekday: number;
  /** false — день соседнего месяца: приглушён. */
  inMonth: boolean;
  isToday: boolean;
  isPast: boolean;
  count: number;
  /** «66 заявок»; день без заявок — «—». */
  countLabel: string;
  csv: boolean;
  segments: CalendarSegment[];
  /** «3 не назначены» — из `by_status.unassigned`. */
  unassignedLabel: string | null;
  /** «1 просрочена» — из `flags.late`. */
  lateLabel: string | null;
  tip: CalendarTip | null;
}

export interface CalendarLegendItem {
  status: RequestStatus;
  label: string;
  tone: StatusTone;
}

export interface CalendarMonth {
  month: string;
  cells: CalendarCell[];
  /** Только статусы полосы, которые встречаются в месяце. */
  legend: CalendarLegendItem[];
  /** Сумма `request_count` за месяц (без дней соседних месяцев). */
  total: number;
  /** В месяце нет ни одной заявки. */
  empty: boolean;
}

/** Порядок строк подсказки: как в полосе, затем статусы вне полосы. */
const TIP_STATUSES: readonly RequestStatus[] = [
  ...CALENDAR_BAR_STATUSES,
  'cancelled',
  'rescheduled',
];

const EMPTY_DAY = '—';

interface DayTotals {
  count: number;
  byStatus: Map<RequestStatus, number>;
  late: number;
  csv: boolean;
}

const positive = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;

const entriesOf = (value: unknown): [string, unknown][] =>
  value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value) : [];

const CSV_SOURCES = new Set(['csv', 'demo']);

/**
 * Дни ответа по дате. Если одна дата пришла несколько раз (например, по регионам) — суммируем.
 * `countByStatus` — при фильтре по статусу число дня — сумма `by_status`: `request_count` бэк
 * считает без этого фильтра (BACKEND_REQUESTS п. 44).
 */
function totalsByDate(
  response: CalendarResponse | null | undefined,
  countByStatus = false,
): Map<string, DayTotals> {
  const days = new Map<string, DayTotals>();
  const list: unknown = response?.days;
  if (!Array.isArray(list)) return days;

  for (const raw of list as Partial<CalendarDay>[]) {
    if (!raw || typeof raw.date !== 'string') continue;
    const date = raw.date.slice(0, 10);
    const day = days.get(date) ?? { count: 0, byStatus: new Map(), late: 0, csv: false };

    let statusSum = 0;
    for (const [status, value] of entriesOf(raw.by_status)) {
      const count = positive(value);
      if (!isRequestStatus(status) || count === 0) continue;
      day.byStatus.set(status, (day.byStatus.get(status) ?? 0) + count);
      statusSum += count;
    }
    // request_count есть всегда; если нет или фильтр по статусу — считаем по статусам.
    day.count +=
      !countByStatus && typeof raw.request_count === 'number'
        ? positive(raw.request_count)
        : statusSum;
    day.late += positive(entriesOf(raw.flags).find(([flag]) => flag === 'late')?.[1]);
    day.csv ||= Array.isArray(raw.sources) && raw.sources.some((source) => CSV_SOURCES.has(source));
    days.set(date, day);
  }
  return days;
}

const unassignedText = (n: number) =>
  `${formatInt(n)} ${plural(n, ['не назначена', 'не назначены', 'не назначены'])}`;

const lateText = (n: number) =>
  `${formatInt(n)} ${plural(n, ['просрочена', 'просрочены', 'просрочены'])}`;

function tipOf(date: string, totals: DayTotals, regions: CalendarRegionRow[]): CalendarTip {
  const rows: CalendarTipRow[] = TIP_STATUSES.flatMap((status) => {
    const count = totals.byStatus.get(status) ?? 0;
    return count > 0
      ? [
          {
            key: status,
            label: REQUEST_STATUS_LABEL[status],
            count,
            tone: REQUEST_STATUS_TONE[status],
          },
        ]
      : [];
  });
  if (totals.late > 0) {
    rows.push({
      key: 'late',
      label: `Флаг «${FLAG_LABEL.late}»`,
      count: totals.late,
      tone: 'danger',
    });
  }
  return { title: `${formatDayTitle(date)} · ${countOf(totals.count, PL_REQUEST)}`, rows, regions };
}

function cellOf(
  date: string,
  month: string,
  today: string,
  totals: DayTotals | undefined,
  regions: CalendarRegionRow[],
): CalendarCell {
  const base = {
    date,
    day: Number(date.slice(8, 10)),
    weekday: isoWeekday(date),
    inMonth: date.startsWith(`${month}-`),
    isToday: date === today,
    isPast: date < today,
  };
  if (!totals || totals.count === 0) {
    return {
      ...base,
      count: 0,
      countLabel: EMPTY_DAY,
      csv: totals?.csv ?? false,
      segments: [],
      unassignedLabel: null,
      lateLabel: null,
      tip: null,
    };
  }
  const segments = CALENDAR_BAR_STATUSES.flatMap((status) => {
    const count = totals.byStatus.get(status) ?? 0;
    return count > 0 ? [{ status, count, tone: REQUEST_STATUS_TONE[status] }] : [];
  });
  const unassigned = totals.byStatus.get('unassigned') ?? 0;
  return {
    ...base,
    count: totals.count,
    countLabel: countOf(totals.count, PL_REQUEST),
    csv: totals.csv,
    segments,
    unassignedLabel: unassigned > 0 ? unassignedText(unassigned) : null,
    lateLabel: totals.late > 0 ? lateText(totals.late) : null,
    tip: tipOf(date, totals, regions),
  };
}

/** Период запроса: вся сетка месяца (целые недели с понедельника) — дни соседних месяцев тоже. */
export function calendarRange(month: string): { from: string; to: string } {
  const days = monthGrid(month);
  return { from: days[0], to: days[days.length - 1] };
}

export interface CalendarBuildOptions {
  /** Выбран фильтр по статусу: число заявок дня — только с этим статусом. */
  countByStatus?: boolean;
  /**
   * «Все регионы» — ответы по каждому региону: в подсказке строка на регион (где неназначенные).
   * Тогда `response` не нужен — итог дня складываем из регионов.
   */
  regions?: readonly { regionId: string; response: CalendarResponse | null | undefined }[];
}

/** Модель сетки месяца. `today` — 'YYYY-MM-DD' по Москве (`todayMsk()`). */
export function buildCalendarMonth(
  month: string,
  response: CalendarResponse | null | undefined,
  today: string,
  { countByStatus = false, regions }: CalendarBuildOptions = {},
): CalendarMonth {
  const combined: CalendarResponse | null | undefined = regions
    ? { days: regions.flatMap((r) => r.response?.days ?? []) }
    : response;
  const totals = totalsByDate(combined, countByStatus);
  const byRegion = (regions ?? []).map((r) => ({
    regionId: r.regionId,
    label: regionLabel(r.regionId),
    totals: totalsByDate(r.response, countByStatus),
  }));
  const regionRows = (date: string): CalendarRegionRow[] =>
    byRegion.flatMap(({ regionId, label, totals: days }) => {
      const day = days.get(date);
      return day && day.count > 0
        ? [{ regionId, label, count: day.count, unassigned: day.byStatus.get('unassigned') ?? 0 }]
        : [];
    });
  const cells = monthGrid(month).map((date) =>
    cellOf(date, month, today, totals.get(date), regionRows(date)),
  );
  const inMonth = cells.filter((cell) => cell.inMonth);
  const seen = new Set(inMonth.flatMap((cell) => cell.segments.map((segment) => segment.status)));
  const total = inMonth.reduce((sum, cell) => sum + cell.count, 0);
  return {
    month,
    cells,
    legend: CALENDAR_BAR_STATUSES.filter((status) => seen.has(status)).map((status) => ({
      status,
      label: REQUEST_STATUS_LABEL[status],
      tone: REQUEST_STATUS_TONE[status],
    })),
    total,
    empty: total === 0,
  };
}

/**
 * Регионов в итоге шапки: выбран регион — 1; «Все регионы» — сколько вернул `/regions`
 * (пока не пришёл — по справочнику).
 */
export function summaryRegionCount(region: string, regions?: readonly unknown[] | null): number {
  if (region !== 'all') return 1;
  return regions?.length || REGIONS.length;
}

/** Итог справа в шапке: «1 314 заявок за месяц · 3 региона». */
export function calendarSummary(total: number, regionCount: number): string {
  return `${countOf(total, PL_REQUEST)} за месяц · ${countOf(regionCount, PL_REGION)}`;
}

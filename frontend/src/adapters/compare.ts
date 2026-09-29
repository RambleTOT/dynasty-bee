/**
 * «Сравнение» и DS-05: наш план / базовый FIFO / реальный диспетчер (FRONTEND_SPEC §6.3).
 * «Наш план» — колонка `plan` (P1-8: действующая версия тем же расчётом, что FIFO), если бэк её
 * посчитал; иначе сводка действующего плана: `ours` перезапускает солвер, а `incremental` на бэке
 * 28.09 отдаёт нули (docs/API_NOTES.md).
 */
import type { BaselineResponse, CompareColumn, CompareResponse, PlanResponse, RouteOut } from '@/api/types';
import { formatDelta, formatInt, formatKm } from '@/lib/format';
import { toMin } from '@/lib/time';
import type { DayModel } from './dayModel';

export interface CompareCell {
  value: string;
  /** Δ к базовому FIFO — только у «Наш план». */
  delta?: string;
  /** «оценка», «нет данных: …». */
  note?: string;
}

export interface CompareRow {
  key: 'engineers' | 'km' | 'unassigned' | 'inWindow' | 'late';
  label: string;
  ours: CompareCell;
  fifo: CompareCell;
  dispatcher: CompareCell;
}

export interface EngineerKmRow {
  engineerId: string;
  label: string;
  short: string;
  color: DayModel['engineers'][number]['color'];
  ours: number | null;
  fifo: number | null;
  dispatcher: number | null;
  tasksOurs: number | null;
  tasksFifo: number | null;
  tasksDispatcher: number;
}

export interface CompareModel {
  rows: CompareRow[];
  note: string;
  /** Колонки «Реальный диспетчер» нет — почему. */
  dispatcherMissing: string | null;
  engineers: EngineerKmRow[];
  maxKm: number;
  hasPlan: boolean;
}

const EMPTY: CompareCell = { value: '—' };

const NOTE_BEFORE_PLAN =
  'Нажмите «Построить план», чтобы заполнить колонку «Наш план». Пробег реального диспетчера — оценка.';
const NOTE_AFTER_PLAN = 'Δ — к базовому FIFO. Пробег реального диспетчера — оценка.';

interface Visit {
  start: string;
  actual_start?: string | null;
  window_start: string;
  window_end: string;
  flags?: string[];
}

const visitsOf = (routes: readonly RouteOut[] | null | undefined): Visit[] =>
  (routes ?? []).flatMap((r) => r.route ?? []);

function startOf(v: Visit): number {
  return toMin(v.actual_start ?? v.start);
}

/** «N/M»: начало (`actual_start ?? start`) в окне. */
export function inWindow(routes: readonly RouteOut[] | null | undefined): { n: number; m: number } | null {
  const visits = visitsOf(routes);
  if (!routes) return null;
  const n = visits.filter((v) => startOf(v) >= toMin(v.window_start) && startOf(v) <= toMin(v.window_end)).length;
  return { n, m: visits.length };
}

/** Начало позже окна или флаг `late`. */
export function lateCount(routes: readonly RouteOut[] | null | undefined): number | null {
  if (!routes) return null;
  return visitsOf(routes).filter((v) => startOf(v) > toMin(v.window_end) || (v.flags ?? []).includes('late')).length;
}

const unassignedFromCoverage = (column: CompareColumn | undefined, total: number) =>
  column && typeof column.coverage_pct === 'number' && Number.isFinite(column.coverage_pct)
    ? Math.round(total * (1 - column.coverage_pct / 100))
    : null;

const num = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? null : n);

export interface CompareInput {
  model: Pick<DayModel, 'engineers' | 'requests' | 'routeByEngineer' | 'synthetic' | 'fromCsv' | 'source'>;
  plan: PlanResponse | null;
  compare: CompareResponse | null;
  baseline: BaselineResponse | null;
}

interface EngineerKm {
  km: number | null;
  tasks: number | null;
}

/**
 * Пробег и число заявок бригады по стратегии. Бэк отдавал это в двух форматах:
 * `columns[s].km_by_engineer: [{engineer_id, km, tasks}]` и `km_by_engineer[id][s] = {km, tasks}` (28.09),
 * раньше — `km_by_engineer[s][id] = km`. Читаем любой.
 */
function engineerKmReader(compare: CompareResponse | null) {
  const columns = (compare?.columns ?? {}) as Record<string, CompareColumn | undefined>;
  const top = (compare?.km_by_engineer ?? {}) as Record<string, unknown>;
  return (strategy: string, engineerId: string): EngineerKm | null => {
    const list = columns[strategy]?.km_by_engineer as { engineer_id?: unknown; km?: unknown; tasks?: unknown }[] | undefined;
    const item = list?.find((x) => x.engineer_id === engineerId);
    if (item) return { km: num(Number(item.km)), tasks: num(Number(item.tasks)) };
    const byEngineer = top[engineerId] as Record<string, { km?: unknown; tasks?: unknown }> | undefined;
    const nested = byEngineer && typeof byEngineer === 'object' ? byEngineer[strategy] : undefined;
    if (nested && typeof nested === 'object') return { km: num(Number(nested.km)), tasks: num(Number(nested.tasks)) };
    const legacy = top[strategy] as Record<string, unknown> | undefined;
    const value = legacy && typeof legacy === 'object' ? legacy[engineerId] : undefined;
    if (typeof value === 'number') return { km: num(value), tasks: null };
    return null;
  };
}

export function buildCompare({ model, plan, compare, baseline }: CompareInput): CompareModel {
  const columns = (compare?.columns ?? {}) as Record<string, CompareColumn | undefined>;
  const kmOf = engineerKmReader(compare);
  const hasPlan = Boolean(plan);
  // `available: false` — у стратегии нет данных (например, диспетчер без контрольного файла)
  const usable = (c: CompareColumn | undefined) => (c && c.available !== false ? c : undefined);
  const fifo = usable(columns.fifo);
  const disp = usable(columns.dispatcher);
  const own = usable(columns.plan);
  const total = plan?.summary.total_requests ?? model.requests.length;

  let dispatcherMissing: string | null = null;
  // колонка есть, но бэк не сопоставил ни одного назначения (0 бригад и 0% охвата) — данных нет
  const dispBroken = Boolean(disp) && disp!.engineers_used === 0 && disp!.coverage_pct === 0;
  if (dispBroken) {
    dispatcherMissing = 'нет данных: назначения не сопоставлены с бригадами';
  } else if (compare && !disp) {
    // CSV без контрольного файла (новые дни 28–29.09 пришли без «Бригады»): диспетчера сравнивать не с чем
    dispatcherMissing = model.synthetic
      ? 'нет данных: синтетический набор'
      : model.source === 'csv'
        ? 'нет данных: контрольный файл не загружен'
        : 'нет данных: только для CSV-дня';
  } else if (!compare && model.synthetic) {
    dispatcherMissing = 'нет данных: синтетический набор';
  }
  const dispMissingCell: CompareCell | null = dispatcherMissing
    ? { value: 'нет данных', note: dispatcherMissing.replace('нет данных: ', '') }
    : null;

  // Задействовано инженеров
  const oursEng = num(own?.engineers_used ?? plan?.summary.engineers_used);
  const fifoEng = num(fifo?.engineers_used);
  const dispEng = num(disp?.engineers_used);

  // Пробег
  const oursKm = num(own?.km_total ?? plan?.summary.total_distance_km);
  const fifoKm = num(fifo?.km_total);
  const dispKm = num(disp?.km_total);

  // Неназначенные: поле бэка (28.09) → базовый план → расчёт из coverage_pct
  const oursUn = num(own?.unassigned ?? plan?.summary.unassigned_count);
  const fifoUn = num(
    fifo?.unassigned ??
      baseline?.baseline.unassigned_count ??
      plan?.metrics?.baseline.unassigned_count ??
      unassignedFromCoverage(fifo, total),
  );
  const dispUn = num(disp?.unassigned ?? unassignedFromCoverage(disp, total));

  // Начато в окне, просрочено: поля бэка (28.09), иначе считаем по маршрутам
  // visits_total = 0 при задействованных бригадах — бэк визиты не посчитал (диспетчер на демо-дне): «—»
  const columnWin = (c: CompareColumn | undefined) =>
    c && c.started_in_window != null && c.visits_total ? { n: c.started_in_window, m: c.visits_total } : null;
  const oursWin = plan ? (columnWin(own) ?? inWindow(plan.routes ?? [])) : null;
  const fifoWin = columnWin(fifo) ?? (baseline?.baseline_routes ? inWindow(baseline.baseline_routes) : null);
  const dispWin = dispatcherMissing ? null : columnWin(disp);
  const oursLate = plan ? num(own?.late ?? lateCount(plan.routes ?? [])) : null;
  const fifoLate = num(fifo?.late ?? (baseline?.baseline_routes ? lateCount(baseline.baseline_routes) : null));
  const dispLate = dispatcherMissing || !disp?.visits_total ? null : num(disp?.late ?? null);

  const cell = (value: number | null, format: (n: number) => string = formatInt): CompareCell =>
    value == null ? EMPTY : { value: format(value) };
  const withDelta = (
    value: number | null,
    base: number | null,
    kind: Parameters<typeof formatDelta>[1],
    format: (n: number) => string = formatInt,
  ): CompareCell => {
    if (value == null || !hasPlan) return EMPTY;
    return {
      value: format(value),
      delta: base == null ? undefined : formatDelta(value - base, kind, kind === 'km' ? base : undefined),
    };
  };
  const km = (n: number) => formatKm(n);
  const winText = (w: { n: number; m: number } | null) => (w ? `${w.n}/${w.m}` : '—');

  const rows: CompareRow[] = [
    {
      key: 'engineers',
      label: 'Задействовано инженеров',
      ours: withDelta(oursEng, fifoEng, 'engineers'),
      fifo: cell(fifoEng),
      dispatcher: dispMissingCell ?? cell(dispEng),
    },
    {
      key: 'km',
      label: 'Пробег суммарно, км',
      ours: withDelta(oursKm, fifoKm, 'km', km),
      fifo: cell(fifoKm, km),
      dispatcher:
        dispMissingCell ??
        (dispKm == null ? EMPTY : { value: km(dispKm), note: disp?.km_is_estimate ? 'оценка' : undefined }),
    },
    {
      key: 'unassigned',
      label: 'Неназначенные',
      ours: withDelta(oursUn, fifoUn, 'count'),
      fifo: cell(fifoUn),
      dispatcher: dispMissingCell ?? cell(dispUn),
    },
    {
      key: 'inWindow',
      label: 'Начато в окне',
      ours:
        oursWin && hasPlan
          ? {
              value: winText(oursWin),
              delta: fifoWin ? formatDelta(oursWin.n - fifoWin.n, 'count') : undefined,
            }
          : EMPTY,
      fifo: { value: winText(fifoWin) },
      dispatcher: dispWin ? { value: winText(dispWin) } : EMPTY,
    },
    {
      key: 'late',
      label: 'Просрочено',
      ours: withDelta(oursLate, fifoLate, 'count'),
      fifo: cell(fifoLate),
      dispatcher: cell(dispLate),
    },
  ];

  const baselineRoutes = new Map((baseline?.baseline_routes ?? []).map((r) => [r.engineer_id, r]));
  // пробег диспетчера по бригадам: одни нули при ненулевом итоге — данных нет (бэк 28.09)
  const dispatcherKmKnown =
    !dispatcherMissing && model.engineers.some((e) => (kmOf('dispatcher', e.id)?.km ?? 0) > 0);
  const dispatcherTasks = new Map<string, number>();
  for (const r of model.requests) {
    if (r.dispatcherEngineerId) dispatcherTasks.set(r.dispatcherEngineerId, (dispatcherTasks.get(r.dispatcherEngineerId) ?? 0) + 1);
  }

  const engineers: EngineerKmRow[] = model.engineers.map((e) => {
    const route = model.routeByEngineer.get(e.id);
    const used = (route?.visits.length ?? 0) > 0;
    const fifoRoute = baselineRoutes.get(e.id);
    const fifoKm = kmOf('fifo', e.id);
    return {
      engineerId: e.id,
      label: e.label,
      short: e.short,
      color: e.color,
      ours: hasPlan && used ? (num(kmOf('plan', e.id)?.km) ?? route?.distanceKm ?? null) : null,
      fifo: num(fifoRoute ? fifoRoute.distance_km : (fifoKm?.km ?? null)),
      dispatcher: dispatcherKmKnown ? (kmOf('dispatcher', e.id)?.km ?? null) : null,
      tasksOurs: hasPlan ? (route?.taskCount ?? 0) : null,
      tasksFifo: fifoRoute ? fifoRoute.task_count : (fifoKm?.tasks ?? null),
      tasksDispatcher: dispatcherTasks.get(e.id) ?? 0,
    };
  });
  const maxKm = Math.max(0, ...engineers.flatMap((e) => [e.ours ?? 0, e.fifo ?? 0]));

  return {
    rows,
    note: hasPlan ? NOTE_AFTER_PLAN : NOTE_BEFORE_PLAN,
    dispatcherMissing,
    engineers,
    maxKm,
    hasPlan,
  };
}

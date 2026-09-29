/**
 * Итоги дня (DS-10, FRONTEND_SPEC §8.2): карточки по статусам, крупные показатели с Δ к FIFO и таблица
 * по бригадам. Считаем по действующему плану; где есть факт — по факту. Δ к FIFO — из модели «Сравнения»
 * (adapters/compare.ts), заново не считаем.
 */
import type { RouteOut } from '@/api/types';
import { formatDateShort, formatInt, formatKm } from '@/lib/format';
import { addDays, toMin } from '@/lib/time';
import type { CompareModel, CompareRow } from './compare';
import { inWindow } from './compare';
import type { DayEngineer, DayModel, DayRoute } from './dayModel';

export type SummaryCardKey = 'done' | 'cancelled' | 'rescheduled' | 'unassigned';

export interface SummaryCard {
  key: SummaryCardKey;
  label: string;
  value: number;
  /** Подпись под числом; нет данных — `null`, строку не выводим. */
  note: string | null;
}

export interface SummaryMetric {
  key: 'inWindow' | 'km' | 'engineers';
  label: string;
  value: string;
  /** «+11 к FIFO»; FIFO нет — `null`. */
  delta: string | null;
  /** Жёлтая плашка ключевой метрики. */
  highlight: boolean;
}

export interface SummaryRow {
  engineerId: string;
  label: string;
  short: string;
  color: DayEngineer['color'];
  tasks: number;
  done: number;
  inWindow: number;
  km: number;
  travelMinutes: number;
  workMinutes: number;
  waitMinutes: number;
}

export interface DaySummary {
  cards: SummaryCard[];
  metrics: SummaryMetric[];
  rows: SummaryRow[];
}

/** Бэк §6: причина отмены (`RequestOut.cancel_reason`). Поле читаем, только если пришло. */
const CANCEL_REASON: Record<string, string> = {
  client_refused: 'клиент отказался',
  no_access: 'нет доступа',
  technical: 'техническая причина',
  other: 'другое',
};

const field = (raw: unknown, key: string): string | null => {
  const value = (raw as Record<string, unknown> | null)?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
};

/** Самое частое значение; пусто — `null`. */
function mostFrequent(values: readonly (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: string | null = null;
  for (const [value, n] of counts) if (best == null || n > (counts.get(best) ?? 0)) best = value;
  return best;
}

type SummaryModel = Pick<DayModel, 'date' | 'plan' | 'requests' | 'routes' | 'engineers'>;

function cardsOf(model: SummaryModel): SummaryCard[] {
  const withStatus = (status: string) => model.requests.filter((r) => r.status === status);
  const assigned = model.routes.reduce((sum, route) => sum + route.visits.length, 0);
  const cancelled = withStatus('cancelled');
  const rescheduled = withStatus('rescheduled');
  const unassigned = withStatus('unassigned');

  const reason = mostFrequent(cancelled.map((r) => field(r.raw, 'cancel_reason')));
  // перенесено на несколько дат — самая ранняя
  const movedDate =
    rescheduled
      .map((r) => field(r.raw, 'rescheduled_to'))
      .filter((d): d is string => Boolean(d && /^\d{4}-\d{2}-\d{2}$/.test(d)))
      .sort()[0] ?? null;

  return [
    {
      key: 'done',
      label: 'Выполнено',
      value: withStatus('done').length,
      note: `из ${formatInt(assigned)} назначенных`,
    },
    {
      key: 'cancelled',
      label: 'Отменено',
      value: cancelled.length,
      note: reason ? (CANCEL_REASON[reason] ?? null) : null,
    },
    {
      key: 'rescheduled',
      label: 'Перенесено',
      value: rescheduled.length,
      note: movedDate ? `на ${formatDateShort(movedDate)}` : null,
    },
    {
      key: 'unassigned',
      label: 'Неназначенные',
      value: unassigned.length,
      note: unassigned.length > 0 ? `перейдут на ${formatDateShort(addDays(model.date, 1))}` : null,
    },
  ];
}

const toFifo = (row: CompareRow | undefined) =>
  row?.ours.delta ? `${row.ours.delta} к FIFO` : null;

function metricsOf(model: SummaryModel, compare: CompareModel | null): SummaryMetric[] {
  const row = (key: CompareRow['key']) => compare?.rows.find((r) => r.key === key);
  const window = model.plan ? inWindow(model.plan.routes ?? []) : null;
  const summary = model.plan?.summary;
  const kmRow = row('km');
  const engineersRow = row('engineers');
  return [
    {
      key: 'inWindow',
      label: 'Начато в окне',
      value: window ? `${formatInt(window.n)} из ${formatInt(window.m)}` : '—',
      delta: toFifo(row('inWindow')),
      highlight: false,
    },
    {
      key: 'km',
      label: 'Пробег суммарно, км',
      value:
        kmRow && kmRow.ours.value !== '—' ? kmRow.ours.value : formatKm(summary?.total_distance_km),
      delta: toFifo(kmRow),
      highlight: true,
    },
    {
      key: 'engineers',
      label: 'Задействовано инженеров',
      value:
        engineersRow && engineersRow.ours.value !== '—'
          ? engineersRow.ours.value
          : summary
            ? formatInt(summary.engineers_used)
            : '—',
      delta: toFifo(engineersRow),
      highlight: false,
    },
  ];
}

/** Работа по визиту: окончание − начало, по факту, если он есть. */
function workMinutes(visit: DayRoute['visits'][number]): number {
  const start = toMin(visit.actualStart ?? visit.start);
  const end = toMin(visit.actualEnd ?? visit.end);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : 0;
}

function rowsOf(model: SummaryModel): SummaryRow[] {
  const rawRoutes = new Map<string, RouteOut>(
    (model.plan?.routes ?? []).map((r) => [r.engineer_id, r]),
  );
  const routes = new Map(model.routes.map((r) => [r.engineerId, r]));
  const rows: SummaryRow[] = [];
  for (const engineer of model.engineers) {
    const route = routes.get(engineer.id);
    if (!route || route.visits.length === 0) continue;
    const raw = rawRoutes.get(engineer.id);
    rows.push({
      engineerId: engineer.id,
      label: engineer.label,
      short: engineer.short,
      color: engineer.color,
      tasks: route.visits.length,
      done: route.visits.filter((v) => v.status === 'done').length,
      inWindow: raw ? (inWindow([raw])?.n ?? 0) : 0,
      km: route.distanceKm,
      travelMinutes: route.visits.reduce((sum, v) => sum + v.travelMinutes, 0),
      workMinutes: route.visits.reduce((sum, v) => sum + workMinutes(v), 0),
      waitMinutes: route.visits.reduce((sum, v) => sum + v.waitingMinutes, 0),
    });
  }
  return rows;
}

export function buildDaySummary(model: SummaryModel, compare: CompareModel | null): DaySummary {
  return { cards: cardsOf(model), metrics: metricsOf(model, compare), rows: rowsOf(model) };
}

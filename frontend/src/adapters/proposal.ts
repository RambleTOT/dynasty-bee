/**
 * Событие → предложение с diff (FRONTEND_SPEC §6.4, DS-06 / DS-07).
 */
import {
  ArrowRightLeft,
  CircleAlert,
  CircleDot,
  CircleMinus,
  Clock,
  ListOrdered,
  Plus,
  type LucideIcon,
} from 'lucide-react';
import type { DispatcherEvent } from '@/api/events';
import type { DiffSummary, EventItem, PlanDiffResponse, UrgentRequestIn } from '@/api/types';
import { BK, engineerVerb as verb, transportLabel } from '@/lib/dictionaries';
import { formatDelta, formatInt, formatKm } from '@/lib/format';
import { fromMin, toMin } from '@/lib/time';
import type { StatusTone } from '@/lib/statuses';
import type { DayModel } from './dayModel';

// ---------- счётчики и заголовки ----------

export interface DiffCounter {
  key: string;
  label: string;
  n: number;
}

export function diffCounters(summary: DiffSummary): DiffCounter[] {
  return [
    { key: 'reassigned', label: 'Передано', n: summary.reassigned },
    { key: 'reordered', label: 'Новый порядок', n: summary.reordered },
    { key: 'time_shifted', label: 'Сдвиг времени', n: summary.time_shifted },
    { key: 'added', label: 'Добавлено', n: summary.added + summary.newly_assigned },
    { key: 'newly_unassigned', label: 'Без исполнителя', n: summary.newly_unassigned },
    { key: 'untouched', label: 'Не тронуто', n: summary.untouched },
  ];
}

/** N в баннере: передано + новый порядок + добавлено + снято + без исполнителя (§8.2, п. 12). */
export function changedAssignments(summary: DiffSummary): number {
  return (
    summary.reassigned +
    summary.reordered +
    summary.added +
    summary.newly_assigned +
    summary.removed +
    summary.newly_unassigned
  );
}

type Labels = Pick<DayModel, 'engineerById' | 'requestById'> & {
  /** Имена бригад, которых ещё нет в дне: новая бригада предложения (P1-6) — из его маршрутов. */
  names?: ReadonlyMap<string, string>;
};

const num = (id: string) => (id.length <= 6 ? id : `…${id.slice(-4)}`);

function engineerName(model: Labels, id: string | null | undefined): string {
  if (!id) return '—';
  return model.engineerById.get(id)?.label ?? model.names?.get(id) ?? `Бригада ${id}`;
}

/** Имя новой бригады из события `engineer_added`: `engineer_name`, иначе по id. */
export function addedEngineerName(model: Labels, payload: Record<string, unknown>): string {
  const name = typeof payload.engineer_name === 'string' ? payload.engineer_name.trim() : '';
  return name || engineerName(model, payload.engineer_id as string | undefined);
}

/** Короткое имя события для заголовков: «Авария №U-0001», «Отмена №…8184», «Бригада Соколов недоступна». */
export function eventTitle(
  model: Labels,
  type: string,
  payload: Record<string, unknown> | null | undefined,
): string {
  const p = payload ?? {};
  const order = String(p.request_id ?? p.order_id ?? '');
  const engineer = engineerName(model, (p.engineer_id ?? p.to_engineer_id) as string | undefined);
  switch (type) {
    case 'urgent_order_added':
      return `Авария №${order}`;
    case 'order_added':
      return `Запись №${order}`;
    case 'order_cancelled':
      return `Отмена №${num(order)}`;
    case 'engineer_unavailable':
      return `${engineer} ${verb(engineer, 'недоступен', 'недоступна')}`;
    case 'engineer_available':
      return `${engineer} снова ${verb(engineer, 'доступен', 'доступна')}`;
    case 'engineer_added':
      return `Новая бригада — ${addedEngineerName(model, p)}`;
    case 'transport_changed':
      return `${engineer}: смена транспорта`;
    case 'manual_reassign':
      return `Переназначение №${num(order)}`;
    case 'engineer_delayed':
      return `${engineer} отстаёт`;
    case 'extend_resource':
      return 'Добор ресурса';
    default:
      return type;
  }
}

// ---------- «Что изменится» ----------

/** Кусок строки «Что изменится»: текст или номер заявки — ссылка на её карточку. */
export type DiffPart = string | { requestId: string; label: string };

export interface DiffItem {
  kind: 'added' | 'reordered' | 'time_shifted' | 'reassigned' | 'removed' | 'newly_unassigned' | 'other';
  label: string;
  /** Строка целиком; `parts` — она же кусками, номера заявок отдельно. */
  text: string;
  parts: DiffPart[];
  icon: LucideIcon;
  tone: StatusTone;
}

export interface DiffGroup {
  engineerId: string | null;
  label: string;
  color: DayModel['engineers'][number]['color'] | null;
  items: DiffItem[];
}

interface Change {
  type?: string;
  request_id?: string;
  engineer_id?: string;
  from_engineer_id?: string;
  to_engineer_id?: string;
  new_start?: string;
  old_start?: string;
  delta_minutes?: number;
  new_position?: number;
  reason_code?: string;
}

const ITEM_STYLE: Record<DiffItem['kind'], { icon: LucideIcon; tone: StatusTone; label: string }> = {
  added: { icon: Plus, tone: 'changed', label: 'Добавлена' },
  reordered: { icon: ListOrdered, tone: 'neutral', label: 'Новый порядок' },
  time_shifted: { icon: Clock, tone: 'warning', label: 'Сдвиг' },
  reassigned: { icon: ArrowRightLeft, tone: 'info', label: 'Передана' },
  removed: { icon: CircleMinus, tone: 'neutral', label: 'Снята' },
  newly_unassigned: { icon: CircleAlert, tone: 'danger', label: 'Без исполнителя' },
  other: { icon: CircleDot, tone: 'neutral', label: 'Изменение' },
};

function item(kind: DiffItem['kind'], parts: DiffPart[], label?: string): DiffItem {
  const style = ITEM_STYLE[kind];
  const text = parts.map((part) => (typeof part === 'string' ? part : part.label)).join('');
  return { kind, text, parts, icon: style.icon, tone: style.tone, label: label ?? style.label };
}

/** Номер заявки ссылкой: «10211», короткий «…4567» или «№10211». */
const ref = (id: string, label: string = num(id)): DiffPart => ({ requestId: id, label });
const refNo = (id: string): DiffPart => ref(id, `№${num(id)}`);

const signedMinutes = (m: number) => `${m > 0 ? '+' : m < 0 ? '−' : ''}${Math.abs(m)} мин`;

export interface DiffContext extends Labels {
  /** Маршруты базовой версии: кому принадлежала снятая заявка. */
  baseEngineerOf: (requestId: string) => string | null;
  /** Порядок визитов бригады в новой версии: для строки «Новый порядок». */
  newOrderOf: (engineerId: string) => string[];
  /** Длительность и тип заявки новой версии (срочной заявки в старом дне нет). */
  requestInfo: (requestId: string) => { typeShort: string; duration: number } | null;
  engineerOrder: readonly string[];
}

/** Изменения по бригадам; передачу кладём в группу бригады «откуда» (§8.2, п. 13). */
export function diffGroups(diff: Pick<PlanDiffResponse, 'changes'>, ctx: DiffContext): DiffGroup[] {
  const groups = new Map<string, DiffGroup>();
  const reorderedDone = new Set<string>();
  const group = (engineerId: string | null): DiffGroup => {
    const key = engineerId ?? '—';
    let g = groups.get(key);
    if (!g) {
      const engineer = engineerId ? ctx.engineerById.get(engineerId) : undefined;
      g = {
        engineerId,
        label: engineerId ? engineerName(ctx, engineerId) : 'Без бригады',
        color: engineer?.color ?? null,
        items: [],
      };
      groups.set(key, g);
    }
    return g;
  };

  for (const raw of (diff.changes ?? []) as Change[]) {
    const id = String(raw.request_id ?? '');
    switch (raw.type) {
      case 'added':
      case 'newly_assigned': {
        const info = ctx.requestInfo(id);
        const start = raw.new_start ?? '';
        const end = info && start ? fromMin(toMin(start) + info.duration) : '';
        const rest = [info?.typeShort, start && end ? `${start}–${end}` : start].filter(Boolean);
        group(raw.engineer_id ?? null).items.push(
          item('added', [ref(id), ...(rest.length ? [` · ${rest.join(' · ')}`] : [])]),
        );
        break;
      }
      case 'reordered': {
        const engineerId = raw.engineer_id ?? null;
        if (engineerId && reorderedDone.has(engineerId)) break;
        if (engineerId) reorderedDone.add(engineerId);
        const order = engineerId ? ctx.newOrderOf(engineerId) : [id];
        group(engineerId).items.push(
          item('reordered', order.flatMap((orderId, index) => (index ? [', ', ref(orderId)] : [ref(orderId)]))),
        );
        break;
      }
      case 'time_shifted': {
        const delta = Number(raw.delta_minutes) || toMin(raw.new_start ?? '') - toMin(raw.old_start ?? '');
        group(raw.engineer_id ?? null).items.push(
          item('time_shifted', [refNo(id), `: ${raw.old_start} → ${raw.new_start} (${signedMinutes(delta)})`]),
        );
        break;
      }
      case 'reassigned': {
        const from = raw.from_engineer_id ?? null;
        group(from).items.push(
          item('reassigned', [
            refNo(id),
            `: ${engineerName(ctx, from)} → ${engineerName(ctx, raw.to_engineer_id)}, ${raw.old_start} → ${raw.new_start}`,
          ]),
        );
        break;
      }
      case 'removed':
        group(ctx.baseEngineerOf(id)).items.push(item('removed', [refNo(id)]));
        break;
      case 'newly_unassigned':
        group(ctx.baseEngineerOf(id)).items.push(item('newly_unassigned', [refNo(id)]));
        break;
      default:
        group(raw.engineer_id ?? null).items.push(item('other', [refNo(id)], `Изменение: ${raw.type ?? '—'}`));
    }
  }

  const order = new Map(ctx.engineerOrder.map((id, i) => [id, i]));
  return [...groups.values()].sort(
    (a, b) => (order.get(a.engineerId ?? '') ?? 999) - (order.get(b.engineerId ?? '') ?? 999),
  );
}

/** «Инженеров 10 → 10 · Пробег 286,5 → 293,0 км (+6,5 км)». */
export function metricsLine(diff: Pick<PlanDiffResponse, 'metrics_before' | 'metrics_after'>): string | null {
  const before = (diff.metrics_before ?? {}) as Record<string, unknown>;
  const after = (diff.metrics_after ?? {}) as Record<string, unknown>;
  const eb = Number(before.engineers_used);
  const ea = Number(after.engineers_used);
  const kb = Number(before.km_total);
  const ka = Number(after.km_total);
  if (![eb, ea, kb, ka].every(Number.isFinite)) return null;
  return `Инженеров ${formatInt(eb)} → ${formatInt(ea)} · Пробег ${formatKm(kb)} → ${formatKm(ka)} км (${formatDelta(ka - kb, 'km')})`;
}

// ---------- карточка решения по аварии ----------

export interface UrgentDecision {
  orderId: string;
  engineerId: string | null;
  engineerLabel: string;
  arrival: string | null;
  start: string | null;
  reactionMin: number | null;
  targetMin: number;
  late: boolean;
}

/** Решение по аварии: из `scenario.urgent` события/ответа, иначе — из diff (`added` по заявке). */
export function urgentDecision(
  model: Labels,
  scenario: Record<string, unknown> | null | undefined,
  diff: Pick<PlanDiffResponse, 'changes'> | null,
  eventTime: string | null,
  orderId: string | null,
): UrgentDecision | null {
  const urgent = (scenario?.urgent ?? null) as Record<string, unknown> | null;
  if (urgent && urgent.order_id) {
    const reaction = urgent.reaction_min;
    const target = Number(urgent.reaction_target_min) || 120;
    const reactionMin = typeof reaction === 'number' && Number.isFinite(reaction) ? reaction : null;
    const engineerId = (urgent.engineer_id as string | null) ?? null;
    return {
      orderId: String(urgent.order_id),
      engineerId,
      engineerLabel: engineerName(model, engineerId),
      arrival: (urgent.arrival as string | undefined) ?? null,
      start: (urgent.start as string | undefined) ?? null,
      reactionMin,
      targetMin: target,
      late: reactionMin != null && reactionMin > target,
    };
  }
  if (!orderId || !diff) return null;
  const added = ((diff.changes ?? []) as Change[]).find(
    (c) => (c.type === 'added' || c.type === 'newly_assigned') && c.request_id === orderId,
  );
  if (!added) return null;
  const start = added.new_start ?? null;
  const reactionMin = start && eventTime ? toMin(start) - toMin(eventTime) : null;
  return {
    orderId,
    engineerId: added.engineer_id ?? null,
    engineerLabel: engineerName(model, added.engineer_id),
    arrival: null,
    start,
    reactionMin: reactionMin != null && Number.isFinite(reactionMin) ? reactionMin : null,
    targetMin: 120,
    late: reactionMin != null && reactionMin > 120,
  };
}

// ---------- тела событий DS-06 ----------

export const URGENT_DURATION_MIN = 80;

export interface UrgentForm {
  planId: string;
  eventTime: string;
  address: string;
  /** Срочная — всегда HD «Авария» (D-37). */
  typeHd: 'Авария';
  transport: string | null;
  /** Максимальный конец смены бригад региона на смене — конец окна аварии (не '22:00'). */
  shiftEnd: string;
  /** Подсказка адреса из заявок дня: её координаты. */
  point?: { lat: number; lon: number } | null;
  district?: string | null;
}

export function newUrgentId(now: number = Date.now()): string {
  return `U-${now.toString(36).toUpperCase()}`;
}

/** Номер срочной заявки «U-0427»: короткий, как в макете, и не совпадает с заявками дня. */
export function urgentIdFor(existing: ReadonlySet<string>, now: number = Date.now()): string {
  let n = Math.floor(now / 1000) % 10000;
  for (let i = 0; i < 10000; i += 1) {
    const id = `U-${String(n).padStart(4, '0')}`;
    if (!existing.has(id)) return id;
    n = (n + 1) % 10000;
  }
  return newUrgentId(now);
}

export function urgentEvent(form: UrgentForm, id = newUrgentId()): DispatcherEvent {
  const request: UrgentRequestIn = {
    id,
    address: form.address.trim(),
    duration_minutes: URGENT_DURATION_MIN,
    window_start: form.eventTime,
    window_end: toMin(form.shiftEnd) > toMin(form.eventTime) ? form.shiftEnd : '23:59',
    priority: 'urgent',
    required_skill: 'emergency',
    required_transport: form.transport,
    type_bk: BK.emergency,
    type_hd: form.typeHd,
    source: 'dispatcher',
    ...(form.point ? { latitude: form.point.lat, longitude: form.point.lon } : {}),
    ...(form.district ? { district: form.district } : {}),
  };
  return { type: 'urgent_order_added', plan_id: form.planId, event_time: form.eventTime, request };
}

export function cancelEvent(
  planId: string,
  eventTime: string,
  orderId: string,
  reason: 'client_refused' | 'other',
  comment?: string,
): DispatcherEvent {
  return {
    type: 'order_cancelled',
    plan_id: planId,
    event_time: eventTime,
    order_id: orderId,
    params: reason === 'other' && comment?.trim() ? { reason, comment: comment.trim() } : { reason },
  };
}

export function unavailableEvent(
  planId: string,
  eventTime: string,
  engineerId: string,
  reason?: string,
): DispatcherEvent {
  return {
    type: 'engineer_unavailable',
    plan_id: planId,
    event_time: eventTime,
    engineer_id: engineerId,
    ...(reason?.trim() ? { params: { reason: reason.trim() } } : {}),
  };
}

/** Макс. `shift_end` бригад региона на смене; нет таких — последний час оси. */
export function maxShiftEnd(model: Pick<DayModel, 'engineers' | 'axis'>): string {
  const ends = model.engineers.filter((e) => e.available).map((e) => toMin(e.shiftEnd)).filter(Number.isFinite);
  if (ends.length) return fromMin(Math.max(...ends));
  return model.axis ? fromMin(model.axis.end) : '23:59';
}

/** Подпись транспорта в форме: «Не требуется» → null. */
export const TRANSPORT_OPTIONS: { value: string; label: string }[] = [
  { value: 'car', label: transportLabel('car') },
  { value: 'public_transport', label: transportLabel('public_transport') },
  { value: 'walk', label: transportLabel('walk') },
  { value: 'bike', label: transportLabel('bike') },
  { value: '', label: 'Не требуется' },
];

/** Время события из ленты: `payload.time` (часы события) или момент записи. */
export function eventTimeOf(event: Pick<EventItem, 'payload'> & { event_time?: string | null }): string | null {
  const time = event.event_time ?? event.payload?.event_time ?? event.payload?.time ?? event.payload?.applied_at;
  return typeof time === 'string' && /^\d{1,2}:\d{2}/.test(time) ? time.slice(0, 5) : null;
}

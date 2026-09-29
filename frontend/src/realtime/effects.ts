/**
 * Что делает страница на событие живых обновлений (docs/REALTIME.md): какие запросы обновить и
 * какой тост показать. Таблица по виду события, без React — проверяется тестами.
 *
 * Запросы обновляем по префиксам ключей (api/queryKeys.ts): чего на экране нет, react-query
 * пропустит. Тосты — только тому, кому нужно действие или ответ: диспетчеру — предложение
 * «ждёт решения», оператору — решение диспетчера по его отмене, переносу, аварии.
 */
import type { QueryKey } from '@tanstack/react-query';
import type { Role } from '@/api/types';
import { formatDateShort } from '@/lib/format';
import type { NotifyKind } from '@/lib/notify';
import { knownRegionName } from '@/lib/regions';
import type { RealtimeEvent } from './protocol';

export interface RealtimeNotice {
  text: string;
  kind: NotifyKind;
  /** Регион и день: «Восток · 29.09». */
  description?: string;
  /** Куда ведёт кнопка «Открыть». */
  link?: string;
  /** Висит, пока не закроют: ждёт решения. */
  persistent?: boolean;
}

export interface RealtimeEffects {
  invalidate: QueryKey[];
  notice: RealtimeNotice | null;
}

/** Всё, что приходит с сервера: после `resync` (события пропущены) обновляем разом. */
export const RESYNC_KEYS: readonly QueryKey[] = [
  ['days'],
  ['calendar'],
  ['plan'],
  ['compare'],
  ['scenario'],
  ['engineerDay'],
  ['engineerRoute'],
  ['booking'],
];

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

/** День диспетчера (с цепочкой версий и лентой) и календарь. */
function dayKeys(event: RealtimeEvent): QueryKey[] {
  return [event.date ? ['days', event.date] : ['days'], ['calendar']];
}
const PLAN: QueryKey[] = [['plan'], ['compare']];
const ENGINEER: QueryKey[] = [['engineerDay'], ['engineerRoute']];
const BOOKING: QueryKey[] = [
  ['booking', 'search'],
  ['booking', 'slots'],
];

function keysFor(event: RealtimeEvent): QueryKey[] {
  const day = dayKeys(event);
  switch (event.kind) {
    case 'day.created':
    case 'day.cleared':
    case 'roster.changed':
      return [...day, ['scenario'], ...BOOKING, ...ENGINEER];
    case 'plan.built':
      return [...day, ['plan']];
    case 'plan.proposed':
      // статус заявки в поиске оператора: «Отменяется», «Переносится»
      return [...day, ['plan'], ...BOOKING];
    case 'plan.published':
    case 'plan.applied':
    case 'plan.rejected':
      return [...day, ...PLAN, ...ENGINEER, ...BOOKING];
    case 'clock.changed':
    case 'engineer.action':
    case 'engineer.route_changed':
      return [...day, ['plan'], ...ENGINEER];
    case 'request.status_changed':
      return [...day, ['plan'], ...ENGINEER, ['booking', 'search']];
    case 'booking.created':
    case 'booking.cancelled':
    case 'booking.rescheduled':
    case 'booking.decision':
      return [...day, ['plan'], ...BOOKING];
    default:
      // незнакомый вид: обновим день, если он известен
      return event.regionId || event.date ? day : [];
  }
}

function place(event: RealtimeEvent): string | undefined {
  const region = knownRegionName(event.regionId);
  const parts = [region, event.date ? formatDateShort(event.date) : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : undefined;
}

/** «Оператор отменил №10211» — чьё предложение и о чём; дальше « — ждёт решения». */
function proposalText(event: RealtimeEvent): string {
  const d = event.data;
  const order = text(d.order_id) ?? text(d.request_id);
  const no = order ? ` №${order}` : '';
  const who = text(d.engineer_name) ?? text(event.actor?.name);
  const source = text(d.source) ?? event.actor?.role ?? null;
  switch (d.event_type) {
    case 'order_cancelled':
      return source === 'engineer'
        ? `${who ?? 'Инженер'}: «Прервать»${no}`
        : `Оператор отменил${no}`;
    case 'order_rescheduled':
      return `Оператор перенёс${no}`;
    case 'urgent_order_added':
      return `Авария${no}`;
    case 'order_added':
      return `Новая запись${no}`;
    case 'engineer_unavailable':
      return `${who ?? 'Бригада'} не может работать`;
    case 'incident':
      return `${who ?? 'Бригада'}: инцидент`;
    case 'engineer_added':
      return 'Новая бригада';
    default:
      return 'Новое предложение';
  }
}

/** Ответ диспетчера оператору: принял или не принял его отмену, перенос, аварию, запись. */
function decisionNotice(event: RealtimeEvent): RealtimeNotice | null {
  const d = event.data;
  const order = text(d.request_id) ?? text(d.order_id);
  if (!order) return null;
  const accepted = d.decision === 'accepted';
  const engineer = text(d.engineer_name);
  const what: Record<string, [string, string]> = {
    cancel: [
      `Диспетчер подтвердил отмену №${order}`,
      `Диспетчер не принял отмену №${order} — заявка остаётся в плане`,
    ],
    reschedule: [`Диспетчер подтвердил перенос №${order}`, `Диспетчер не принял перенос №${order}`],
    emergency: [
      engineer ? `Авария №${order} → ${engineer}` : `Авария №${order} назначена`,
      `Диспетчер не принял аварию №${order}`,
    ],
    create: [`Запись №${order} встала в план`, `Диспетчер не принял запись №${order}`],
  };
  const pair = what[String(d.action)];
  if (!pair) return null;
  return {
    text: accepted ? pair[0] : pair[1],
    kind: accepted ? 'success' : 'info',
    description: place(event),
  };
}

export function effectsFor(event: RealtimeEvent, role: Role | null): RealtimeEffects {
  const invalidate = keysFor(event);
  let notice: RealtimeNotice | null = null;

  if (
    role === 'dispatcher' &&
    event.kind === 'plan.proposed' &&
    event.actor?.role !== 'dispatcher'
  ) {
    const planId = text(event.data.plan_id);
    notice = {
      text: `${proposalText(event)} — ждёт решения`,
      kind: 'info',
      description: place(event),
      link:
        planId && event.date && event.regionId
          ? `/dispatcher/day/${event.date}?region=${event.regionId}&proposal=${encodeURIComponent(planId)}`
          : undefined,
      persistent: true,
    };
  } else if (role === 'operator' && event.kind === 'booking.decision') {
    notice = decisionNotice(event);
  }

  return { invalidate, notice };
}

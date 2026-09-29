/**
 * «Пересчитать» устаревшее предложение (BACKEND_REQUESTS п. 48): то же событие — на действующей
 * версии. Ручки `rebase` у бэка нет, а в журнале тело события неполное: у срочной только номер —
 * заявку берём из сценария предложения, остальное — из `payload` события.
 */
import type { DispatcherEvent } from '@/api/events';
import type { EventItem, RequestOut, UrgentRequestIn } from '@/api/types';
import { eventTarget } from './dayChain';
import { eventTimeOf } from './proposal';

const RESENDABLE: ReadonlySet<string> = new Set([
  'urgent_order_added',
  'order_cancelled',
  'engineer_unavailable',
  'engineer_available',
  'transport_changed',
]);

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

/** Событие такого типа фронт умеет собрать заново. */
export const canRebuild = (event: Pick<EventItem, 'event_type'>): boolean =>
  RESENDABLE.has(event.event_type);

/** Для сборки нужна заявка из сценария предложения (у срочной в журнале только номер). */
export const needsScenarioRequest = (event: Pick<EventItem, 'event_type'>): boolean =>
  event.event_type === 'urgent_order_added';

/** Номер заявки события — чтобы найти её в сценарии предложения. */
export const requestIdOf = (event: Pick<EventItem, 'event_type' | 'payload'>): string | null =>
  eventTarget(event);

function urgentBody(request: RequestOut): UrgentRequestIn {
  const coords =
    Number.isFinite(request.latitude) && Number.isFinite(request.longitude)
      ? { latitude: request.latitude, longitude: request.longitude }
      : {};
  return {
    id: request.id,
    duration_minutes: request.duration_minutes,
    window_start: request.window_start,
    window_end: request.window_end,
    priority: 'urgent',
    required_skill: request.required_skill,
    ...coords,
    ...(text(request.address) ? { address: text(request.address) as string } : {}),
    ...(text(request.required_transport)
      ? { required_transport: text(request.required_transport) as string }
      : {}),
    ...(text(request.type_bk) ? { type_bk: text(request.type_bk) as string } : {}),
    ...(text(request.type_hd) ? { type_hd: text(request.type_hd) as string } : {}),
    ...(text(request.district) ? { district: text(request.district) as string } : {}),
    source: 'dispatcher',
  };
}

/**
 * Событие устаревшего предложения → то же событие к версии `planId`. Время события — прежнее:
 * авария случилась тогда же. Не собрать (тип не тот, нет заявки) — `null`.
 */
export function rebuildEvent(
  event: Pick<EventItem, 'event_type' | 'payload'> & { event_time?: string | null },
  planId: string,
  request: RequestOut | null = null,
): DispatcherEvent | null {
  const p = event.payload ?? {};
  const time = eventTimeOf(event);
  const at = time ? { event_time: time } : {};
  switch (event.event_type) {
    case 'urgent_order_added':
      return request
        ? { type: 'urgent_order_added', plan_id: planId, ...at, request: urgentBody(request) }
        : null;
    case 'order_cancelled': {
      const orderId = text(p.request_id) ?? text(p.order_id);
      if (!orderId) return null;
      const params: { reason: string; comment?: string; stage?: string; previous_status?: string } =
        { reason: text(p.reason) ?? 'other' };
      if (text(p.comment)) params.comment = text(p.comment) as string;
      if (text(p.stage)) params.stage = text(p.stage) as string;
      if (text(p.previous_status)) params.previous_status = text(p.previous_status) as string;
      return { type: 'order_cancelled', plan_id: planId, ...at, order_id: orderId, params };
    }
    case 'engineer_unavailable': {
      const engineerId = text(p.engineer_id);
      if (!engineerId) return null;
      const reason = text(p.reason);
      return {
        type: 'engineer_unavailable',
        plan_id: planId,
        ...at,
        engineer_id: engineerId,
        ...(reason ? { params: { reason } } : {}),
      };
    }
    case 'engineer_available': {
      const engineerId = text(p.engineer_id);
      return engineerId
        ? { type: 'engineer_available', plan_id: planId, ...at, engineer_id: engineerId }
        : null;
    }
    case 'transport_changed': {
      const engineerId = text(p.engineer_id);
      const transport = text(p.transport);
      return engineerId && transport
        ? {
            type: 'transport_changed',
            plan_id: planId,
            ...at,
            engineer_id: engineerId,
            params: { transport },
          }
        : null;
    }
    default:
      return null;
  }
}

/** События дня (FRONTEND_SPEC §6.4): все с apply: false, id заявки — order_id. */
import { api } from './client';
import type { EventItem, ReplanResult, UrgentRequestIn } from './types';

type Signal = AbortSignal | undefined;

export type DispatcherEvent =
  | {
      type: 'urgent_order_added';
      plan_id: string;
      event_time?: string;
      request: UrgentRequestIn;
    }
  | {
      type: 'order_cancelled';
      plan_id: string;
      event_time?: string;
      order_id: string;
      /**
       * Из окна события — `client_refused` | `other`; при пересчёте устаревшего предложения —
       * причина из журнала как есть (у «Прервать» инженера ещё `stage` и `previous_status`).
       */
      params: { reason: string; comment?: string; stage?: string; previous_status?: string };
    }
  | {
      type: 'engineer_unavailable';
      plan_id: string;
      event_time?: string;
      engineer_id: string;
      params?: { reason?: string };
    }
  | {
      type: 'engineer_available';
      plan_id: string;
      event_time?: string;
      engineer_id: string;
    }
  | {
      type: 'transport_changed';
      plan_id: string;
      event_time?: string;
      engineer_id: string;
      params: { transport: string };
    }
  | {
      /** P1-6: новая бригада в начатый день, id выдаёт бэк (флаг `addEngineerAfterPublish`). */
      type: 'engineer_added';
      plan_id: string;
      event_time?: string;
      engineer: NewBrigade;
    };

export interface NewBrigade {
  name: string;
  skills: string[];
  transport: string;
  shift_start: string;
  shift_end: string;
  start: { kind: 'office' };
  latitude?: number;
  longitude?: number;
}

export function applyEvent(event: DispatcherEvent) {
  return api.post<ReplanResult>('/events/apply', { ...event, source: 'dispatcher', apply: false });
}

/**
 * Журнал событий. Бэк режет по `limit` до фильтра по сценарию, а события на версиях после первого
 * предложения записаны на производные сценарии — поэтому для дня берём общий список и фильтруем
 * по цепочке версий (adapters/dayChain.ts).
 */
export const listEvents = (
  filter: { scenarioId?: string | null; planId?: string | null; limit?: number } = {},
  signal?: Signal,
) =>
  api.get<EventItem[]>('/events', {
    query: {
      scenario_id: filter.scenarioId ?? undefined,
      plan_id: filter.planId ?? undefined,
      limit: filter.limit ?? 200,
    },
    signal,
  });

/**
 * Протокол живых обновлений (WebSocket) — контракт с бэком: docs/BACKEND_REQUESTS.md п. 38,
 * устройство на фронте — docs/REALTIME.md.
 *
 * Сервер → клиент, по JSON в сообщении:
 *   {"type":"hello","protocol":1,"seq":1042,"resumed":true}
 *   {"type":"event","seq":1043,"id":"…","kind":"plan.proposed","at":"…","region_id":"east",
 *    "date":"2026-09-29","actor":{"role":"operator","name":"Оператор"},"data":{…}}
 *   {"type":"ping"}   {"type":"resync"}   {"type":"error","code":"…","message":"…"}
 * Клиент серверу ничего не шлёт: действия — как и раньше, через REST.
 *
 * Разбираем безопасно: незнакомый тип сообщения — `null`, незнакомый вид события — пропускает
 * таблица эффектов (effects.ts).
 */

export const REALTIME_PROTOCOL = 1;

/** Виды событий v1 — каталог с полями `data` в BACKEND_REQUESTS п. 38. */
export const REALTIME_KINDS = [
  'day.created',
  'day.cleared',
  'plan.built',
  'plan.published',
  'plan.proposed',
  'plan.applied',
  'plan.rejected',
  'clock.changed',
  'request.status_changed',
  'booking.created',
  'booking.cancelled',
  'booking.rescheduled',
  'booking.decision',
  'engineer.action',
  'engineer.route_changed',
  'roster.changed',
] as const;

export type RealtimeKind = (typeof REALTIME_KINDS)[number];

export interface RealtimeActor {
  role: string | null;
  name: string | null;
}

export interface RealtimeEvent {
  /** Сквозной номер события на сервере: по нему отбрасываем повторы и просим пропущенное. */
  seq: number;
  id: string | null;
  kind: string;
  /** Время события на сервере, ISO. */
  at: string | null;
  regionId: string | null;
  /** День события 'YYYY-MM-DD'. */
  date: string | null;
  actor: RealtimeActor | null;
  data: Record<string, unknown>;
}

export type ServerMessage =
  | { type: 'hello'; protocol: number; seq: number; resumed: boolean }
  | { type: 'event'; event: RealtimeEvent }
  | { type: 'ping' }
  | { type: 'resync' }
  | { type: 'error'; code: string; message: string };

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const str = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null;

const seqOf = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;

export const isRealtimeKind = (kind: string): kind is RealtimeKind =>
  (REALTIME_KINDS as readonly string[]).includes(kind);

function eventOf(row: Json): RealtimeEvent | null {
  const seq = seqOf(row.seq);
  const kind = str(row.kind);
  if (seq === null || !kind) return null;
  const actor = isObject(row.actor)
    ? { role: str(row.actor.role), name: str(row.actor.name) }
    : null;
  return {
    seq,
    id: str(row.id),
    kind,
    at: str(row.at),
    regionId: str(row.region_id),
    date: str(row.date),
    actor,
    data: isObject(row.data) ? row.data : {},
  };
}

/** Сообщение сокета (строка JSON) → сообщение протокола; мусор и незнакомое — `null`. */
export function parseServerMessage(raw: unknown): ServerMessage | null {
  let row: unknown = raw;
  if (typeof raw === 'string') {
    try {
      row = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!isObject(row)) return null;
  switch (row.type) {
    case 'hello': {
      const seq = seqOf(row.seq);
      return seq === null
        ? null
        : {
            type: 'hello',
            protocol: typeof row.protocol === 'number' ? row.protocol : REALTIME_PROTOCOL,
            seq,
            resumed: row.resumed === true,
          };
    }
    case 'event': {
      const event = eventOf(row);
      return event ? { type: 'event', event } : null;
    }
    case 'ping':
      return { type: 'ping' };
    case 'resync':
      return { type: 'resync' };
    case 'error':
      return { type: 'error', code: str(row.code) ?? 'ERROR', message: str(row.message) ?? '' };
    default:
      return null;
  }
}

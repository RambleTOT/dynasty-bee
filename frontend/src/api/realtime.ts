/**
 * Живые обновления (docs/BACKEND_REQUESTS.md п. 38): разовый билет по REST с токеном, затем
 * WebSocket по билету — токен в адрес сокета не кладём (он попал бы в журналы nginx и бэка).
 */
import { API_URL } from '@/config';
import { api } from './client';

export interface RealtimeTicket {
  /** Одноразовый, живёт ~30 с. */
  ticket: string;
  expires_in?: number;
}

export async function getRealtimeTicket(): Promise<string> {
  const { ticket } = await api.post<RealtimeTicket>('/realtime/ticket');
  return ticket;
}

/**
 * `wss://<сайт>/api/v1/realtime/ws?ticket=…&since=…`. API_URL относительный — хост страницы
 * (в dev Vite проксирует и сокет), абсолютный — его хост с ws/wss.
 */
export function realtimeUrl(
  ticket: string,
  since: number | null,
  base: string = API_URL,
  page: Pick<Location, 'protocol' | 'host'> = window.location,
): string {
  const root = /^https?:\/\//.test(base)
    ? base.replace(/^http/, 'ws')
    : `${page.protocol === 'https:' ? 'wss:' : 'ws:'}//${page.host}${base}`;
  const params = new URLSearchParams({ ticket });
  if (since !== null) params.set('since', String(since));
  return `${root}/realtime/ws?${params.toString()}`;
}

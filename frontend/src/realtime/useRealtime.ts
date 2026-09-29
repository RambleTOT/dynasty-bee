import { createContext, useContext } from 'react';
import { REALTIME } from '@/config';
import type { RealtimeStatus } from './client';

/** Состояние сокета живых обновлений; без провайдера (тесты, флаг выключен) — `idle`. */
export const RealtimeContext = createContext<RealtimeStatus>('idle');

export const useRealtimeStatus = (): RealtimeStatus => useContext(RealtimeContext);

/**
 * Интервал опроса запроса: пока сокет открыт, обновления приходят событиями — опрос редкий,
 * на случай потерянного события; сокета нет — обычный интервал (POLL).
 */
export function usePollInterval(base: number): number {
  return useRealtimeStatus() === 'open' ? Math.max(base, REALTIME.safetyPollMs) : base;
}

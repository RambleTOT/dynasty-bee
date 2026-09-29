/**
 * Сеанс живых обновлений: сокет, реакция на события, переподключение при возврате сети.
 * Отдельным чанком — грузится, только когда флаг `realtime` включён (RealtimeProvider).
 */
import type { QueryClient } from '@tanstack/react-query';
import { getRealtimeTicket, realtimeUrl } from '@/api/realtime';
import type { Role } from '@/api/types';
import { dismiss, notify } from '@/lib/notify';
import { RealtimeClient, type RealtimeStatus } from './client';
import { effectsFor, RESYNC_KEYS } from './effects';
import { createInvalidationBatch } from './invalidationBatch';

export interface RealtimeSessionOptions {
  role: Role;
  queryClient: QueryClient;
  /** Переход по «Открыть» в тосте. */
  navigate: (to: string) => void;
  onStatus: (status: RealtimeStatus) => void;
}

/** Открывает сокет; возвращает «закрыть». */
export function startRealtime({ role, queryClient, navigate, onStatus }: RealtimeSessionOptions) {
  const batch = createInvalidationBatch(queryClient);
  const client = new RealtimeClient({
    getTicket: getRealtimeTicket,
    url: (ticket, since) => realtimeUrl(ticket, since),
    onEvent: (event) => {
      const { invalidate, notice, dismiss: decided } = effectsFor(event, role);
      batch.add(invalidate);
      for (const key of decided) dismiss(key);
      if (!notice) return;
      const link = notice.link;
      notify(notice.text, notice.kind, {
        description: notice.description,
        persistent: notice.persistent,
        key: notice.key,
        action: link ? { label: 'Открыть', onClick: () => navigate(link) } : undefined,
      });
    },
    onResync: () => batch.add(RESYNC_KEYS),
    onStatus,
  });
  client.start();
  // сеть вернулась — переподключаемся сразу, не дожидаясь паузы
  const online = () => client.reconnectNow();
  window.addEventListener('online', online);
  return () => {
    window.removeEventListener('online', online);
    client.stop();
    batch.cancel();
  };
}

import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { REALTIME } from '@/config';

/**
 * Обновление запросов пачкой: события за `delay` мс (автопрогон часов двигает десятки статусов
 * разом) — одним проходом, каждый ключ один раз.
 */
export function createInvalidationBatch(client: QueryClient, delay: number = REALTIME.batchMs) {
  const pending = new Map<string, QueryKey>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  function flush() {
    timer = undefined;
    const keys = [...pending.values()];
    pending.clear();
    for (const queryKey of keys) void client.invalidateQueries({ queryKey });
  }

  return {
    add(keys: readonly QueryKey[]) {
      for (const key of keys) pending.set(JSON.stringify(key), key);
      if (keys.length > 0 && timer === undefined) timer = setTimeout(flush, delay);
    },
    cancel() {
      clearTimeout(timer);
      timer = undefined;
      pending.clear();
    },
  };
}

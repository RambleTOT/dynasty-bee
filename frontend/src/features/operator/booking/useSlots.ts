import { skipToken, useQuery } from '@tanstack/react-query';
import { normalizeSlots } from '@/adapters/booking';
import { getSlots, type SlotsQuery } from '@/api/booking';
import { queryKeys } from '@/api/queryKeys';
import { POLL } from '@/config';

/** Ключ окон — по нему же кладём свежие окна из ответа 409 SLOT_TAKEN (⏳ 9.5). */
export const slotsKey = (params: SlotsQuery) => queryKeys.bookingSlots({ ...params });

const sameType = (a: Record<string, unknown> | undefined, b: SlotsQuery) =>
  a?.type_bk === b.type_bk && a?.type_hd === b.type_hd;

/**
 * Окна записи (FRONTEND_SPEC §8.3.4). `live` — шаг «Дата и окно» и перенос: опрос каждые 30 с
 * и при возврате на вкладку (в фоне — нет). Фоном на шаге 1 — без опроса; пока BK и HD те же,
 * держим прошлый ответ, чтобы строка навыка не мигала при вводе адреса.
 */
export function useSlots(params: SlotsQuery | null, { live }: { live: boolean }) {
  return useQuery({
    queryKey: params ? slotsKey(params) : queryKeys.bookingSlots({}),
    queryFn: params ? ({ signal }) => getSlots(params, signal) : skipToken,
    select: normalizeSlots,
    refetchInterval: live ? POLL.slots : false,
    refetchOnWindowFocus: live,
    placeholderData: (previous, previousQuery) =>
      !live && params && sameType(previousQuery?.queryKey[2], params) ? previous : undefined,
  });
}

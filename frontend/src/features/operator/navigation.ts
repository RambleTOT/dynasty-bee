/** Переходы между экранами оператора (FRONTEND_SPEC §8.3.3). */
import type { BookingItem, BookingRef } from '@/adapters/booking';

/** Состояние перехода в перенос: заявка уже найдена — второй раз не ищем; `q` — чтобы вернуться. */
export interface RescheduleState {
  item: BookingItem;
  q: string;
}

/** Регион и день заявки — в адресе: номера повторяются в разных днях и регионах. */
function dayParams(params: URLSearchParams, ref: BookingRef) {
  if (ref.regionId) params.set('region', ref.regionId);
  if (ref.date) params.set('date', ref.date);
}

export function rescheduleUrl(ref: BookingRef): string {
  const params = new URLSearchParams();
  dayParams(params, ref);
  const query = params.toString();
  return `/operator/reschedule/${encodeURIComponent(ref.id)}${query ? `?${query}` : ''}`;
}

/**
 * O-02 с выбранной заявкой: `/operator?request=<id>&region=…&date=…`. Строку поиска возвращаем,
 * если она была [Д]: тогда слева снова тот же список.
 */
export function searchUrl(ref: BookingRef, q?: string | null): string {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  params.set('request', ref.id);
  dayParams(params, ref);
  return `/operator?${params.toString()}`;
}

/** Заявку не нашли по номеру — в поиск с этим номером. */
export const searchByIdUrl = (requestId: string) =>
  `/operator?${new URLSearchParams({ q: requestId }).toString()}`;

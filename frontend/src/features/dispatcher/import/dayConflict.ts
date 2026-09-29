import type { DayRegion } from '@/api/types';

/**
 * Что уже есть у участка на дату. CSV — новый файл его заменит: бэк отправит прежний CSV-день в
 * архив (перед загрузкой — предупреждение и подтверждение). Записи оператора — CSV бэк не примет
 * (`DATE_HAS_BOOKINGS`). Демо-день не мешает: календарь создаёт его на сегодня сам.
 */
export type DayConflict = 'replace' | 'blocked';

export function dayConflict(
  data: { regions: DayRegion[] } | undefined,
  regionId: string | null,
): DayConflict | null {
  if (!regionId) return null;
  const day = data?.regions.find((region) => region.region_id === regionId && region.scenario_id);
  if (day?.source === 'csv') return 'replace';
  if (day?.source === 'booking') return 'blocked';
  return null;
}

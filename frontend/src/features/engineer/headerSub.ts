import { formatDayMonth } from '@/lib/format';
import { knownRegionName } from '@/lib/regions';

/**
 * Подпись под именем в шапке инженера: «Восток · 29 сентября». Регион — из токена, дата — дня,
 * который показывает бэк: так видно, тот ли это день и регион, что открыт у диспетчера.
 */
export function headerSub(
  regionIds: readonly string[] | undefined,
  date: string | null | undefined,
): string | null {
  const region = regionIds?.map(knownRegionName).find(Boolean) ?? null;
  const parts = [region, date ? formatDayMonth(date) : null];
  const text = parts.filter(Boolean).join(' · ');
  return text || null;
}

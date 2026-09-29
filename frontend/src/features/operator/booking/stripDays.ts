import { addDays, monthOf } from '@/lib/time';

/** Дней в ленте дат. */
export const STRIP_DAYS = 14;

/**
 * С какого дня лента: дата в ближайших двух неделях — с сегодня; дальше (выбрали в календаре,
 * заявка на ноябрь) — с неё за три дня до, но не раньше сегодня.
 */
export function stripStart(value: string, today: string): string {
  if (value <= addDays(today, STRIP_DAYS - 1)) return today;
  const start = addDays(value, -3);
  return start < today ? today : start;
}

export interface MonthSegment {
  month: string;
  /** Индекс первого дня месяца в ленте. */
  from: number;
  span: number;
}

/** Подписи месяцев над лентой: месяц — над своими днями. */
export function monthSegments(days: readonly string[]): MonthSegment[] {
  const segments: MonthSegment[] = [];
  days.forEach((day, index) => {
    const month = monthOf(day);
    const last = segments[segments.length - 1];
    if (last?.month === month) last.span += 1;
    else segments.push({ month, from: index, span: 1 });
  });
  return segments;
}

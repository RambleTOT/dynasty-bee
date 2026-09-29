/** Форматы чисел, дат и времени для интерфейса (русская локаль, Москва). */
import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import { TZ } from '@/config';

/** Настоящий знак минуса — как в макетах («−38,2 км»). */
export const MINUS = '−';

/** «заявка / заявки / заявок». */
export function plural(n: number, forms: readonly [string, string, string]): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (last === 1) return forms[0];
  if (last >= 2 && last <= 4) return forms[1];
  return forms[2];
}

export const PL_REQUEST = ['заявка', 'заявки', 'заявок'] as const;
export const PL_ENGINEER = ['инженер', 'инженера', 'инженеров'] as const;
export const PL_BRIGADE = ['бригада', 'бригады', 'бригад'] as const;
export const PL_REGION = ['регион', 'региона', 'регионов'] as const;
export const PL_ROW = ['строка', 'строки', 'строк'] as const;

/** «5 заявок». */
export const countOf = (n: number, forms: readonly [string, string, string]) =>
  `${formatInt(n)} ${plural(n, forms)}`;

const intFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });

/** «1 314». */
export function formatInt(n: number): string {
  return intFormat.format(Math.round(n)).replace(/[\u00a0\u202f]/g, ' ');
}

/** «42,3» — км с одним знаком после запятой. */
export function formatKm(km: number | null | undefined, digits = 1): string {
  if (km == null || !Number.isFinite(km)) return '—';
  return km.toFixed(digits).replace('.', ',');
}

/** «42,3 км». */
export const formatKmUnit = (km: number | null | undefined) =>
  km == null || !Number.isFinite(km) ? '—' : `${formatKm(km)} км`;

const signOf = (n: number) => (n < 0 ? MINUS : n > 0 ? '+' : '');

export type DeltaKind = 'km' | 'engineers' | 'requests' | 'count';

/**
 * Δ в одном формате для всего интерфейса (FRONTEND_SPEC §8.2, п. 17):
 * «−38,2 км (−12%)», «−2 инженера», «−4 заявки», «+9».
 * `base` — значение, от которого считаем процент (только для км).
 */
export function formatDelta(delta: number, kind: DeltaKind, base?: number | null): string {
  if (!Number.isFinite(delta)) return '';
  const abs = Math.abs(delta);
  const sign = signOf(delta);
  switch (kind) {
    case 'km': {
      const value = `${sign}${formatKm(abs)} км`;
      if (!base || !Number.isFinite(base) || delta === 0) return value;
      return `${value} (${sign}${Math.round((abs / base) * 100)}%)`;
    }
    case 'engineers':
      return `${sign}${formatInt(abs)} ${plural(abs, PL_ENGINEER)}`;
    case 'requests':
      return `${sign}${formatInt(abs)} ${plural(abs, PL_REQUEST)}`;
    case 'count':
      return `${sign}${formatInt(abs)}`;
  }
}

/** «2 ч 10 мин», «35 мин», «5 ч». */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return '—';
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h && m) return `${h} ч ${m} мин`;
  if (h) return `${h} ч`;
  return `${m} мин`;
}

/** «2:05» — часы:минуты для таблиц. */
export function formatHoursMinutes(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return '—';
  const total = Math.max(0, Math.round(minutes));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

// --- даты 'YYYY-MM-DD' (календарные, без часового пояса) ---

const dateOf = (ymd: string) => parseISO(ymd);
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** «Пн, 29 сентября». */
export const formatDayTitle = (ymd: string) =>
  capitalize(format(dateOf(ymd), 'EEEEEE, d MMMM', { locale: ru }));

/** «29 сентября». */
export const formatDayMonth = (ymd: string) => format(dateOf(ymd), 'd MMMM', { locale: ru });

/** «Сентябрь 2026» по 'YYYY-MM'. */
export const formatMonthTitle = (month: string) =>
  capitalize(format(parseISO(`${month}-01`), 'LLLL yyyy', { locale: ru }));

/** «Сентябрь» по 'YYYY-MM'. */
export const formatMonthName = (month: string) =>
  capitalize(format(parseISO(`${month}-01`), 'LLLL', { locale: ru }));

/** «29.09». */
export const formatDateShort = (ymd: string) => format(dateOf(ymd), 'dd.MM');

/** «29.09.2026». */
export const formatDateFull = (ymd: string) => format(dateOf(ymd), 'dd.MM.yyyy');

/** «Пн». */
export const formatWeekdayShort = (ymd: string) =>
  capitalize(format(dateOf(ymd), 'EEEEEE', { locale: ru }));

/** «Вт, 29.09». */
export const formatDateWithWeekday = (ymd: string) =>
  `${formatWeekdayShort(ymd)}, ${formatDateShort(ymd)}`;

// --- моменты времени ISO (с часовым поясом) → Москва ---

const isoTime = new Intl.DateTimeFormat('ru-RU', {
  timeZone: TZ,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** '2026-09-29T09:31:00Z' → «12:31» (Москва). Уже 'HH:MM' — как есть. */
export function timeOfIso(value: string | null | undefined): string {
  if (!value) return '';
  if (/^\d{1,2}:\d{2}/.test(value)) return value.slice(0, 5);
  // бэк хранит UTC; без пояса в строке (SQLite) — считаем её UTC, а не местным временем браузера
  const date = new Date(/T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(value) ? `${value}Z` : value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = isoTime.formatToParts(date);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value) % 24;
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${String(hour).padStart(2, '0')}:${minute}`;
}

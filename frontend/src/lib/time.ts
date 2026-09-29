import { TZ } from '@/config';

const pad2 = (n: number) => String(n).padStart(2, '0');

const timeFormat = new Intl.DateTimeFormat('ru-RU', {
  timeZone: TZ,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const dateFormat = new Intl.DateTimeFormat('ru-RU', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number {
  return Number(parts.find((p) => p.type === type)?.value);
}

/** Реальное время в Москве, 'HH:MM'. */
export function nowMsk(date: Date = new Date()): string {
  const parts = timeFormat.formatToParts(date);
  // Некоторые движки в полночь отдают '24' вместо '00'.
  return `${pad2(part(parts, 'hour') % 24)}:${pad2(part(parts, 'minute'))}`;
}

/** Сегодняшняя дата в Москве, 'YYYY-MM-DD'. */
export function todayMsk(date: Date = new Date()): string {
  const parts = dateFormat.formatToParts(date);
  return `${part(parts, 'year')}-${pad2(part(parts, 'month'))}-${pad2(part(parts, 'day'))}`;
}

/**
 * «Сейчас» дня: часы дня (`clock`, D-24), если бэк их задал, иначе реальное московское время.
 * Часы во фронте только показываем — переводит их бэк (D-28).
 */
export function nowFor(clock?: string | null): string {
  return clock || nowMsk();
}

const TIME = /^(\d{1,2}):(\d{2})(?::\d{2})?$/;

/** 'HH:MM' → минуты от полуночи. Не время — `NaN`. */
export function toMin(time: string): number {
  const match = TIME.exec(time.trim());
  if (!match) return Number.NaN;
  const minutes = Number(match[2]);
  return minutes > 59 ? Number.NaN : Number(match[1]) * 60 + minutes;
}

/** Минуты от полуночи → 'HH:MM'. 1440 → '24:00' (конец суток), отрицательные → '00:00'. */
export function fromMin(minutes: number): string {
  if (!Number.isFinite(minutes)) return '--:--';
  const total = Math.max(0, Math.round(minutes));
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}

export interface TimeWindow {
  start: string;
  end: string;
}

/** Окно '10:00-12:00' (также с «–» и пробелами) → `{ start: '10:00', end: '12:00' }`; не окно — `null`. */
export function parseWindow(value: string): TimeWindow | null {
  const match = /^\s*(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})\s*$/.exec(value);
  if (!match) return null;
  const start = toMin(match[1]);
  const end = toMin(match[2]);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return { start: fromMin(start), end: fromMin(end) };
}

// --- ось таймлайна (FRONTEND_SPEC §10.3): часы из смен, 10:00 / 22:00 не зашиваем ---

export interface TimeAxis {
  /** Минуты от полуночи, кратно часу. */
  start: number;
  end: number;
}

/** Ось по сменам бригад дня: min `shift_start` вниз до часа, max `shift_end` вверх до часа. */
export function timelineAxis(shifts: readonly { start: string; end: string }[]): TimeAxis | null {
  const starts = shifts.map((s) => toMin(s.start)).filter(Number.isFinite);
  const ends = shifts.map((s) => toMin(s.end)).filter(Number.isFinite);
  if (starts.length === 0 || ends.length === 0) return null;
  const start = Math.floor(Math.min(...starts) / 60) * 60;
  const end = Math.ceil(Math.max(...ends) / 60) * 60;
  return end > start ? { start, end } : null;
}

/** Отметки целых часов оси, в минутах. */
export function axisHours(axis: TimeAxis): number[] {
  const hours: number[] = [];
  for (let m = axis.start; m <= axis.end; m += 60) hours.push(m);
  return hours;
}

/** Доля 0…1 положения момента на оси (за краями — обрезаем). */
export function axisFraction(minutes: number, axis: TimeAxis): number {
  if (!Number.isFinite(minutes)) return 0;
  const fraction = (minutes - axis.start) / (axis.end - axis.start);
  return Math.min(1, Math.max(0, fraction));
}

// --- календарные даты 'YYYY-MM-DD' (считаем в UTC, чтобы не мешал переход на летнее время) ---

const utc = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
const ymdOf = (date: Date) => date.toISOString().slice(0, 10);

export function addDays(ymd: string, days: number): string {
  const date = utc(ymd);
  date.setUTCDate(date.getUTCDate() + days);
  return ymdOf(date);
}

/** День недели ISO: 1 — понедельник, 7 — воскресенье. */
export function isoWeekday(ymd: string): number {
  return utc(ymd).getUTCDay() || 7;
}

/** 'YYYY-MM' даты. */
export const monthOf = (ymd: string) => ymd.slice(0, 7);

export function addMonths(month: string, count: number): string {
  const [year, m] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, m - 1 + count, 1));
  return date.toISOString().slice(0, 7);
}

/** Первый и последний день месяца. */
export function monthRange(month: string): { from: string; to: string } {
  const from = `${month}-01`;
  return { from, to: addDays(`${addMonths(month, 1)}-01`, -1) };
}

/** Сетка месяца для календаря: целые недели с понедельника, включая дни соседних месяцев. */
export function monthGrid(month: string): string[] {
  const { from, to } = monthRange(month);
  const start = addDays(from, 1 - isoWeekday(from));
  const end = addDays(to, 7 - isoWeekday(to));
  const days: string[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) days.push(day);
  return days;
}

/** Часть времени для окна: «18», «14:30». */
function windowPart(time: string): string {
  const minutes = toMin(time);
  if (!Number.isFinite(minutes)) return time;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? String(h) : `${h}:${pad2(m)}`;
}

/** Окно коротко, как в макетах: «18–20», «14:30–16». */
export function windowShort(start: string, end: string): string {
  return `${windowPart(start)}–${windowPart(end)}`;
}

/** Окно полностью: «18:00–20:00». */
export function windowFull(start: string, end: string): string {
  const s = toMin(start);
  const e = toMin(end);
  return `${Number.isFinite(s) ? fromMin(s) : start}–${Number.isFinite(e) ? fromMin(e) : end}`;
}

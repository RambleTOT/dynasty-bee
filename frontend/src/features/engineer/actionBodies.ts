/**
 * Тела действий инженера из шторок (FRONTEND_SPEC §9.2, §9.3): «Прервать» (`fail`), «Инцидент»
 * (`incident` ⏳), «Не могу работать» (`unavailable`). Проверка обязательных полей — до отправки.
 */
import { formatDateShort } from '@/lib/format';
import type { Transport } from '@/lib/statuses';
import { fromMin, toMin } from '@/lib/time';

type Payload = Record<string, unknown>;

/** Готовое тело или ошибка у поля. */
export type BodyResult<F extends string> = { payload: Payload } | { field: F; error: string };

export type FailReason = 'client_refused' | 'no_access' | 'client_reschedule' | 'other';

/** «Прервать выполнение» (E-06): перенос — с желаемой датой (завтра…+14), «Другое» — с текстом. */
export function failPayload(
  reason: FailReason,
  {
    desiredDate,
    comment,
    minDate,
    maxDate,
  }: {
    desiredDate: string;
    comment: string;
    minDate: string;
    maxDate: string;
  },
): BodyResult<'desiredDate' | 'comment'> {
  if (reason === 'client_reschedule') {
    if (!desiredDate) return { field: 'desiredDate', error: 'Укажите желаемую дату' };
    if (desiredDate < minDate || desiredDate > maxDate) {
      return {
        field: 'desiredDate',
        error: `Дата — с ${formatDateShort(minDate)} по ${formatDateShort(maxDate)}`,
      };
    }
    return { payload: { reason, desired_date: desiredDate } };
  }
  if (reason === 'other') {
    const text = comment.trim();
    if (!text) return { field: 'comment', error: 'Обязательное поле' };
    return { payload: { reason, comment: text } };
  }
  return { payload: { reason } };
}

export type IncidentReason = 'transport_broken' | 'cannot_continue' | 'other';

/** «Инцидент» (E-07 ⏳ 8.4): сломался транспорт — с новым, «Другое» — с текстом. */
export function incidentPayload(
  reason: IncidentReason,
  { newTransport, comment }: { newTransport: Transport | null; comment: string },
): BodyResult<'newTransport' | 'comment'> {
  if (reason === 'transport_broken') {
    if (!newTransport) return { field: 'newTransport', error: 'Выберите новый транспорт' };
    return { payload: { reason, new_transport: newTransport } };
  }
  if (reason === 'other') {
    const text = comment.trim();
    if (!text) return { field: 'comment', error: 'Обязательное поле' };
    return { payload: { reason, comment: text } };
  }
  return { payload: { reason } };
}

export type UnavailableReason = 'sick' | 'family' | 'none';

/** «Не могу работать» / «Не выйду сегодня» (E-08): `from` — 'now' или 'HH:MM'; «Без причины» — без reason. */
export function unavailablePayload(from: string, reason: UnavailableReason): Payload {
  return reason === 'none' ? { from } : { from, reason };
}

const STEP_MIN = 15;

/** Время «С какого времени» шагом 15 мин: после «сейчас» и до конца смены (без неё — до конца суток). */
export function quarterHours(now: string, shiftEnd: string | null): string[] {
  const start = toMin(now);
  const end = shiftEnd ? toMin(shiftEnd) : 24 * 60;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [];
  const times: string[] = [];
  for (let m = Math.floor(start / STEP_MIN) * STEP_MIN + STEP_MIN; m < end; m += STEP_MIN) {
    times.push(fromMin(m));
  }
  return times;
}

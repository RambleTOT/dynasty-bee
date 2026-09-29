/** Запись O-01.2: тело POST /booking/requests и тост по ответу (FRONTEND_SPEC §8.3.8). */
import type { BookingOutcome } from '@/adapters/booking';
import type { BookingRequestIn } from '@/api/types';
import { dateShort, phoneToApi, windowShort } from '@/lib/booking';
import { T } from '../operatorTexts';
import type { BookingForm } from './useBookingForm';

/** Технология FMC / FTTB — только у Востока, у остальных регионов — `null`. */
export const TECHNOLOGY_REGION = 'east';

export function bookingRequestBody(
  form: BookingForm & { window: string },
  region: string,
  district?: string,
): BookingRequestIn {
  return {
    region_id: region,
    date: form.date,
    window: form.window,
    type_bk: form.typeBk,
    type_hd: form.typeHd,
    address: form.address.trim(),
    // ⏳ 9.7: район — если бэк вернул его в окнах
    district,
    gigabit: form.gigabit,
    technology: region === TECHNOLOGY_REGION ? form.technology : null,
    required_transport: form.transport,
    client_contact: phoneToApi(form.contact),
  };
}

/** Тост успеха: `message` бэка (⏳ 9.4) важнее; иначе — по статусу, дате и окну записи. */
export function bookedText(outcome: BookingOutcome, body: BookingRequestIn): string {
  // бригаду не поставили: текст бэка («Инженера назначит диспетчер») звучит как успех — пишем свой
  if (outcome.message && outcome.status !== 'unassigned') return outcome.message;
  const date = dateShort(outcome.date ?? body.date);
  const window = windowShort(outcome.window ?? body.window);
  // HTTP 202: день ещё пересчитывается
  if (outcome.status === 'recalculating') return T.book.okRecalc(date, window);
  if (outcome.status === 'unassigned') return T.book.okUnassigned(outcome.requestId, date, window);
  return T.book.okPlanned(outcome.requestId, date, window);
}

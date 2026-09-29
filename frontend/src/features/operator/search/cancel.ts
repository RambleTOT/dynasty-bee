/** Отмена заявки оператором: причины и тело запроса (FRONTEND_SPEC §8.3.6, ⏳ 9.3). */
import type { BookingCancelBody, CancelReason } from '@/api/types';
import { dateShort } from '@/lib/booking';
import { T } from '../operatorTexts';

/** «Другое» — только когда бэк принимает комментарий (флаг `cancelComment`). */
export function cancelReasons(withComment: boolean): CancelReason[] {
  return withComment
    ? ['client_refused', 'booking_error', 'other']
    : ['client_refused', 'booking_error'];
}

/** Тело отмены. «Другое» без текста не отправляем — `null`. */
export function cancelBody(reason: CancelReason, comment: string): BookingCancelBody | null {
  if (reason !== 'other') return { reason };
  const text = comment.trim();
  return text ? { reason, comment: text } : null;
}

/** Тост после отмены, если бэк не прислал `message` (⏳ 9.4): по дате заявки. */
export function cancelDoneText(date: string, today: string): string {
  return date > today ? T.cancel.doneFuture(dateShort(date)) : T.cancel.doneToday;
}

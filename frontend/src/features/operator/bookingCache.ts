/** Общее для мутаций оператора: инвалидация кэша и тексты ошибок (FRONTEND_SPEC §8.3.4). */
import type { QueryClient } from '@tanstack/react-query';
import { errorMessage, isApiError } from '@/api/errors';
import { T } from './operatorTexts';

/** После любой мутации — поиск и окна заново. */
export function invalidateBooking(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: ['booking', 'search'] });
  void queryClient.invalidateQueries({ queryKey: ['booking', 'slots'] });
}

/** Статус заявки мог измениться (ILLEGAL_TRANSITION) — обновляем поиск и карточку. */
export function refreshSearch(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: ['booking', 'search'] });
}

export const hasErrorCode = (error: unknown, code: string): boolean =>
  isApiError(error) && error.code === code;

/** Тост об ошибке мутации: 422 формы — «Проверьте заполнение полей», иначе текст бэка. */
export function mutationErrorText(error: unknown): string {
  return hasErrorCode(error, 'VALIDATION_ERROR') ? T.validation : errorMessage(error);
}

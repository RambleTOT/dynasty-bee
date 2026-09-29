/**
 * Тост «Заявка №… выполнена» (кадр E-03.3): белая карточка сверху на 4 с. Живёт вне React, чтобы
 * показаться и после смены экрана (выполнили из карточки заявки → вернулись к списку).
 */
import { useSyncExternalStore } from 'react';
import type { EngineerVisitModel } from '@/adapters/engineerDay';
import { ADDRESS_MISSING, requestNoShort } from '@/lib/engineerLabels';
import { formatKm } from '@/lib/format';

export interface DoneToastText {
  title: string;
  /** «{начало}–{конец} · следующая — {адрес}, {км} км»; нечего сказать — null. */
  description: string | null;
}

const HIDE_AFTER_MS = 4_000;

let current: DoneToastText | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function hideDoneToast(): void {
  clearTimeout(timer);
  current = null;
  emit();
}

export function showDoneToast(text: DoneToastText): void {
  clearTimeout(timer);
  current = text;
  timer = setTimeout(hideDoneToast, HIDE_AFTER_MS);
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const snapshot = () => current;

export const useDoneToast = () => useSyncExternalStore(subscribe, snapshot, snapshot);

/**
 * Тексты тоста (§9.2 E-03): время по факту ⏳ 8.6 — если пришло; следующая — адрес и км плеча.
 */
export function doneToastText(
  requestId: string,
  done: Pick<EngineerVisitModel, 'actualStart' | 'actualEnd'> | null,
  next: Pick<EngineerVisitModel, 'addressShort' | 'legKm'> | null,
): DoneToastText {
  const parts: string[] = [];
  if (done?.actualStart && done.actualEnd) parts.push(`${done.actualStart}–${done.actualEnd}`);
  if (next) {
    const km = next.legKm != null ? `, ${formatKm(next.legKm)} км` : '';
    parts.push(`следующая — ${next.addressShort || ADDRESS_MISSING}${km}`);
  }
  return {
    title: `Заявка ${requestNoShort(requestId)} выполнена`,
    description: parts.length ? parts.join(' · ') : null,
  };
}

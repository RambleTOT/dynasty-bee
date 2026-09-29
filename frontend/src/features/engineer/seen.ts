/**
 * Отметки «просмотрено» в localStorage — UI-мелочь (FRONTEND_SPEC §9.2, §9.3):
 * `seen_banner_<at>_<type>` — баннер «План изменён» просмотрен (E-09);
 * `seen_changed_<request_id>` — карточку открывали, флаг «Изменено» больше не показываем (E-03.1).
 */
import { useSyncExternalStore } from 'react';
import type { EngineerVisitModel } from '@/adapters/engineerDay';

// localStorage недоступен (приватный режим) — помним до перезагрузки.
const memory = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

function emit() {
  version += 1;
  for (const listener of listeners) listener();
}

export function isSeen(key: string): boolean {
  try {
    return window.localStorage.getItem(key) !== null || memory.has(key);
  } catch {
    return memory.has(key);
  }
}

export function markSeen(key: string): void {
  if (isSeen(key)) return;
  try {
    window.localStorage.setItem(key, '1');
  } catch {
    memory.add(key);
  }
  emit();
}

function unmark(key: string): void {
  memory.delete(key);
  try {
    window.localStorage.removeItem(key);
  } catch {
    // нечего очищать
  }
}

export const changedKey = (requestId: string) => `seen_changed_${requestId}`;

/** Флаг «Изменено» видно, пока карточку не открыли. */
export const showChanged = (visit: Pick<EngineerVisitModel, 'id' | 'flags'>) =>
  visit.flags.includes('changed') && !isSeen(changedKey(visit.id));

/**
 * Флаг «Изменено» у заявки пропал (новая версия плана её не тронула) — забываем отметку, чтобы
 * следующее изменение снова было видно.
 */
export function forgetStaleChanged(visits: readonly Pick<EngineerVisitModel, 'id' | 'flags'>[]) {
  let changed = false;
  for (const visit of visits) {
    const key = changedKey(visit.id);
    if (!visit.flags.includes('changed') && isSeen(key)) {
      unmark(key);
      changed = true;
    }
  }
  if (changed) emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const snapshot = () => version;

/** Перерисовать компонент, когда отметки меняются. */
export const useSeenVersion = () => useSyncExternalStore(subscribe, snapshot, snapshot);

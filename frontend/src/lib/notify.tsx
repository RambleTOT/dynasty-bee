import { CircleCheck, CircleX, Info, TriangleAlert, X } from 'lucide-react';
import { useSyncExternalStore, type ReactNode } from 'react';
import styles from './notify.module.css';

export type NotifyKind = 'info' | 'error' | 'success' | 'warning';

export interface NotifyOptions {
  /** Вторая строка тоста. */
  description?: string;
  /** Кнопка в тосте: «Новая запись». */
  action?: { label: string; onClick: () => void };
  /** Не скрывать через 4 с — висит, пока не закроют. */
  persistent?: boolean;
  /** Ключ: по нему тост закрывают, когда повод исчез (`dismiss`) — например, предложение уже решено. */
  key?: string;
}

interface Notice extends NotifyOptions {
  id: number;
  text: string;
  kind: NotifyKind;
}

const HIDE_AFTER_MS = 4_000;

// Стек живёт вне React, поэтому notify() можно звать откуда угодно: из обработчиков, эффектов, api.
let notices: readonly Notice[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function emit() {
  for (const listener of listeners) listener();
}

function hide(id: number) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  notices = notices.filter((notice) => notice.id !== id);
  emit();
}

function scheduleHide(id: number, persistent?: boolean) {
  clearTimeout(timers.get(id));
  if (persistent) return;
  timers.set(
    id,
    setTimeout(() => hide(id), HIDE_AFTER_MS),
  );
}

/**
 * Тост внизу экрана на 4 с (тёмная плашка дизайн-системы). Такой же уже на экране — не дублируем,
 * а продлеваем.
 */
// eslint-disable-next-line react-refresh/only-export-components -- API стека, а не компонент
export function notify(text: string, kind: NotifyKind = 'info', options: NotifyOptions = {}): void {
  const same = notices.find((notice) => notice.text === text && notice.kind === kind);
  if (same) {
    scheduleHide(same.id, options.persistent);
    return;
  }
  const id = nextId++;
  notices = [...notices, { id, text, kind, ...options }];
  scheduleHide(id, options.persistent);
  emit();
}

/** Закрыть тосты с ключом `key`: повод исчез — предложение приняли или отклонили. */
// eslint-disable-next-line react-refresh/only-export-components -- API стека, а не компонент
export function dismiss(key: string): void {
  const gone = notices.filter((notice) => notice.key === key);
  if (gone.length === 0) return;
  for (const notice of gone) {
    clearTimeout(timers.get(notice.id));
    timers.delete(notice.id);
  }
  notices = notices.filter((notice) => notice.key !== key);
  emit();
}

/** Закрыть все тосты (например, при уходе со страницы записи или при выходе из учётки). */
// eslint-disable-next-line react-refresh/only-export-components -- API стека, а не компонент
export function dismissAll(): void {
  for (const id of timers.keys()) clearTimeout(timers.get(id));
  timers.clear();
  notices = [];
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => notices;

const ICON = { info: Info, success: CircleCheck, error: CircleX, warning: TriangleAlert } as const;

/** Рендерит приложение и стек тостов поверх него. */
export function NotifyProvider({ children }: { children: ReactNode }) {
  const items = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return (
    <>
      {children}
      <div className={styles.stack} aria-live="polite">
        {items.map((notice) => {
          const Icon = ICON[notice.kind];
          return (
            <div
              key={notice.id}
              role={notice.kind === 'error' ? 'alert' : 'status'}
              className={styles.item}
            >
              <Icon size={20} className={styles[notice.kind]} aria-hidden />
              <div className={styles.text}>
                <div className={styles.title}>{notice.text}</div>
                {notice.description && (
                  <div className={styles.description}>{notice.description}</div>
                )}
              </div>
              {notice.action && (
                <button
                  type="button"
                  className={styles.action}
                  onClick={() => {
                    hide(notice.id);
                    notice.action?.onClick();
                  }}
                >
                  {notice.action.label}
                </button>
              )}
              {(notice.persistent || notice.action) && (
                <button
                  type="button"
                  aria-label="Закрыть"
                  className={styles.close}
                  onClick={() => hide(notice.id)}
                >
                  <X size={18} aria-hidden />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let lockCount = 0;

/** Открытые окна по порядку: Esc и Tab — только у верхнего (окно поверх дровера, подтверждение). */
const stack: symbol[] = [];

/**
 * Поведение модального окна: фокус внутрь при открытии и назад при закрытии, Tab по кругу,
 * Esc закрывает, прокрутка страницы под окном заблокирована. Окна друг над другом: клавиши
 * обрабатывает верхнее.
 */
export function useModalBehavior(
  open: boolean,
  panelRef: RefObject<HTMLElement | null>,
  onClose?: () => void,
) {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>('[data-autofocus]') ?? panel;
    first?.focus({ preventScroll: true });

    lockCount += 1;
    document.body.style.overflow = 'hidden';
    const id = Symbol('overlay');
    stack.push(id);

    function onKeyDown(event: KeyboardEvent) {
      if (stack[stack.length - 1] !== id) return;
      if (event.key === 'Escape' && onCloseRef.current) {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null,
      );
      if (items.length === 0) return;
      const head = items[0];
      const tail = items[items.length - 1];
      if (event.shiftKey && document.activeElement === head) {
        event.preventDefault();
        tail.focus();
      } else if (!event.shiftKey && document.activeElement === tail) {
        event.preventDefault();
        head.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      stack.splice(stack.indexOf(id), 1);
      lockCount -= 1;
      if (lockCount === 0) document.body.style.overflow = '';
      previous?.focus?.({ preventScroll: true });
    };
  }, [open, panelRef]);
}

/** Закрыть по клику снаружи и по Esc (поповеры, меню). */
export function useDismiss(
  open: boolean,
  containerRef: RefObject<HTMLElement | null>,
  onDismiss: () => void,
) {
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onDismissRef.current();
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onDismissRef.current();
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, containerRef]);
}

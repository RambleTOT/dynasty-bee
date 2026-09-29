import { X } from 'lucide-react';
import { useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from './cx';
import { IconButton } from './IconButton';
import { useModalBehavior } from './useOverlay';
import styles from './Overlay.module.css';

interface OverlayProps {
  open: boolean;
  onClose?: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  /** Справа в шапке, перед ✕: бейдж, «Изменить». */
  headerAside?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
}

function Header({
  titleId,
  title,
  subtitle,
  headerAside,
  onClose,
  className,
}: {
  titleId: string;
  title?: ReactNode;
  subtitle?: ReactNode;
  headerAside?: ReactNode;
  onClose?: () => void;
  className?: string;
}) {
  if (!title && !onClose) return null;
  return (
    <header className={cx(styles.header, className)}>
      <div className={styles.titles}>
        {title && (
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
        )}
        {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
      </div>
      {headerAside}
      {onClose && (
        <IconButton icon={X} label="Закрыть" size="sm" variant="tertiary" onClick={onClose} />
      )}
    </header>
  );
}

/** Модальное окно по центру: 480 / 560 / 720 / 1200 (DESIGN_SPEC §3). */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  headerAside,
  footer,
  children,
  width = 560,
  className,
  bodyClassName,
}: OverlayProps & { width?: 480 | 560 | 720 | 1200 }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModalBehavior(open, panelRef, onClose);
  if (!open) return null;
  return createPortal(
    <div
      className={styles.scrim}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={cx(styles.modal, className)}
        style={{ width }}
      >
        <Header
          titleId={titleId}
          title={title}
          subtitle={subtitle}
          headerAside={headerAside}
          onClose={onClose}
        />
        <div className={cx(styles.body, bodyClassName)}>{children}</div>
        {footer && <footer className={styles.footer}>{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

/** Дровер справа на всю высоту: 480 (карточка) / 560 (предложение, состав). */
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  headerAside,
  footer,
  children,
  width = 480,
  className,
  bodyClassName,
}: OverlayProps & { width?: 480 | 560 }) {
  const panelRef = useRef<HTMLElement>(null);
  const titleId = useId();
  useModalBehavior(open, panelRef, onClose);
  if (!open) return null;
  return createPortal(
    <div
      className={cx(styles.scrim, styles.scrimDrawer)}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={cx(styles.drawer, className)}
        style={{ width }}
      >
        <Header
          titleId={titleId}
          title={title}
          subtitle={subtitle}
          headerAside={headerAside}
          onClose={onClose}
          className={styles.drawerHeader}
        />
        <div className={cx(styles.body, styles.drawerBody, bodyClassName)}>{children}</div>
        {footer && <footer className={cx(styles.footer, styles.drawerFooter)}>{footer}</footer>}
      </aside>
    </div>,
    document.body,
  );
}

/** Шторка снизу для телефона: ручка, скругление 24 сверху, действия внизу. */
export function BottomSheet({
  open,
  onClose,
  title,
  subtitle,
  footer,
  children,
  className,
  bodyClassName,
}: OverlayProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModalBehavior(open, panelRef, onClose);
  if (!open) return null;
  return createPortal(
    <div
      className={cx(styles.scrim, styles.scrimSheet)}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={cx(styles.sheet, className)}
      >
        <span className={styles.handle} aria-hidden />
        {(title || subtitle) && (
          <header className={styles.sheetHeader}>
            {title && (
              <h2 id={titleId} className={styles.title}>
                {title}
              </h2>
            )}
            {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
          </header>
        )}
        <div className={cx(styles.sheetBody, bodyClassName)}>{children}</div>
        {footer && <footer className={styles.sheetFooter}>{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

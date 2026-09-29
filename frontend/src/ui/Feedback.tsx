import {
  CircleAlert,
  CircleCheck,
  CircleX,
  Info,
  TriangleAlert,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { StatusTone } from '@/lib/statuses';
import { Button } from './Button';
import { cx } from './cx';
import styles from './Feedback.module.css';

const CALLOUT_ICON: Record<StatusTone, LucideIcon> = {
  success: CircleCheck,
  info: Info,
  warning: TriangleAlert,
  danger: CircleAlert,
  changed: Info,
  neutral: Info,
};

/**
 * Плашка с иконкой: «Все три ограничения соблюдены» (success), рекомендация в «Составе» (info),
 * «Заявки, где нужен автомобиль…» (warning), «Это окно только что заняли» (danger),
 * «Аварию распределит диспетчер…» (neutral).
 */
export function Callout({
  tone = 'neutral',
  icon,
  children,
  action,
  className,
}: {
  tone?: StatusTone;
  icon?: LucideIcon | null;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const Icon = icon === null ? null : (icon ?? CALLOUT_ICON[tone]);
  return (
    <div
      className={cx(styles.callout, styles[tone], className)}
      role={tone === 'danger' ? 'alert' : undefined}
    >
      {Icon && <Icon size={16} className={styles.calloutIcon} aria-hidden />}
      <div className={styles.calloutText}>{children}</div>
      {action}
    </div>
  );
}

/** Тёмная полоса или карточка: предложение ждёт решения (DS-03), «План изменён» (E-09). */
export function DarkBanner({
  icon: Icon,
  title,
  children,
  aside,
  action,
  layout = 'strip',
  className,
}: {
  icon?: LucideIcon;
  title?: ReactNode;
  children?: ReactNode;
  aside?: ReactNode;
  action?: ReactNode;
  layout?: 'strip' | 'card';
  className?: string;
}) {
  return (
    <div className={cx(styles.banner, styles[layout], className)} role="status">
      {Icon && <Icon size={20} className={styles.bannerIcon} aria-hidden />}
      <div className={styles.bannerText}>
        {title && <div className={styles.bannerTitle}>{title}</div>}
        {children && <div className={styles.bannerBody}>{children}</div>}
      </div>
      {aside && <span className={styles.bannerAside}>{aside}</span>}
      {action}
    </div>
  );
}

/** Пустое состояние списка или панели (тексты — DESIGN_SPEC §7.5). */
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx(styles.empty, className)}>
      {Icon && <Icon size={24} className={styles.emptyIcon} aria-hidden />}
      <div className={styles.emptyTitle}>{title}</div>
      {children && <div className={styles.emptyBody}>{children}</div>}
      {action}
    </div>
  );
}

/** Ошибка загрузки с «Повторить». */
export function ErrorState({
  message = 'Не удалось связаться с сервером',
  onRetry,
  retrying = false,
  className,
}: {
  message?: ReactNode;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
}) {
  return (
    <div className={cx(styles.empty, className)} role="alert">
      <WifiOff size={24} className={styles.emptyIcon} aria-hidden />
      <div className={styles.emptyTitle}>{message}</div>
      {onRetry && (
        <Button variant="tertiary" size="sm" onClick={onRetry} loading={retrying}>
          Повторить
        </Button>
      )}
    </div>
  );
}

/** Скелетон: серый блок с мягкой пульсацией. */
export function Skeleton({
  width,
  height = 16,
  radius = 'var(--radius-sm)',
  className,
}: {
  width?: number | string;
  height?: number | string;
  radius?: string;
  className?: string;
}) {
  return (
    <span
      className={cx(styles.skeleton, className)}
      style={{ width, height, borderRadius: radius }}
      aria-hidden
    />
  );
}

/** Иконка-тон для тостов и плашек без текста. */
export const TONE_ICON = { success: CircleCheck, danger: CircleX, info: Info } as const;

import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  FLAG_ICON,
  FLAG_LABEL,
  FLAG_TONE,
  REQUEST_STATUS_ICON,
  REQUEST_STATUS_LABEL,
  REQUEST_STATUS_TONE,
  type Flag,
  type RequestStatus,
  type StatusTone,
} from '@/lib/statuses';
import { cx } from './cx';
import styles from './Chip.module.css';

export type ChipSize = 'sm' | 'md';

interface ToneChipProps {
  tone?: StatusTone;
  icon?: LucideIcon | null;
  size?: ChipSize;
  className?: string;
  title?: string;
  children: ReactNode;
}

/** Пилюля статуса: текст `--st-{tone}` на `--st-{tone}-bg`, иконка слева (DESIGN_SPEC §2.4). */
export function ToneChip({
  tone = 'neutral',
  icon: Icon,
  size = 'md',
  className,
  title,
  children,
}: ToneChipProps) {
  return (
    <span className={cx(styles.chip, styles[tone], styles[size], className)} title={title}>
      {Icon && <Icon size={size === 'sm' ? 12 : 14} strokeWidth={2} aria-hidden />}
      {children}
    </span>
  );
}

/** Статус заявки: подпись, тон и иконка — только из lib/statuses.ts. */
export function StatusChip({
  status,
  size,
  className,
}: {
  status: RequestStatus;
  size?: ChipSize;
  className?: string;
}) {
  return (
    <ToneChip
      tone={REQUEST_STATUS_TONE[status]}
      icon={REQUEST_STATUS_ICON[status]}
      size={size}
      className={className}
    >
      {REQUEST_STATUS_LABEL[status]}
    </ToneChip>
  );
}

/** Флаг «Срочная»: заливка danger, белый текст. */
export function UrgentFlag({ size = 'md', className }: { size?: ChipSize; className?: string }) {
  const Icon = FLAG_ICON.urgent;
  return (
    <span className={cx(styles.chip, styles.urgent, styles[size], className)}>
      <Icon size={size === 'sm' ? 12 : 14} strokeWidth={2} aria-hidden />
      {FLAG_LABEL.urgent}
    </span>
  );
}

/**
 * Флаг заявки. `iconOnly` — для плотных мест (таймлайн): только иконка с подписью в тултипе.
 * Цвет не несёт смысл один: у иконки всегда есть подпись (title / aria-label).
 */
export function FlagChip({
  flag,
  size = 'md',
  iconOnly = false,
  className,
}: {
  flag: Flag;
  size?: ChipSize;
  iconOnly?: boolean;
  className?: string;
}) {
  const Icon = FLAG_ICON[flag];
  if (iconOnly) {
    return (
      <span
        className={cx(styles.flagIcon, styles[`fg_${FLAG_TONE[flag]}`], className)}
        title={FLAG_LABEL[flag]}
        role="img"
        aria-label={FLAG_LABEL[flag]}
      >
        <Icon size={size === 'sm' ? 12 : 14} strokeWidth={2} aria-hidden />
      </span>
    );
  }
  if (flag === 'urgent') return <UrgentFlag size={size} className={className} />;
  return (
    <ToneChip tone={FLAG_TONE[flag]} icon={Icon} size={size} className={className}>
      {FLAG_LABEL[flag]}
    </ToneChip>
  );
}

/** Нейтральный бейдж: «CSV», «Синтетика», счётчики. `micro` — капс 11 px. */
export function Badge({
  children,
  micro = false,
  inverse = false,
  className,
  title,
}: {
  children: ReactNode;
  micro?: boolean;
  inverse?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <span
      className={cx(styles.badge, micro && styles.micro, inverse && styles.inverse, className)}
      title={title}
    >
      {children}
    </span>
  );
}

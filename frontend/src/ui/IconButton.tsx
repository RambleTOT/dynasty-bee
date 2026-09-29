import type { LucideIcon } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cx } from './cx';
import styles from './IconButton.module.css';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  /** Подпись для скринридера и тултип. */
  label: string;
  variant?: 'secondary' | 'tertiary' | 'ghost' | 'primary';
  size?: 'sm' | 'md' | 'lg';
  badge?: number | string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    icon: Icon,
    label,
    variant = 'tertiary',
    size = 'md',
    badge,
    className,
    type = 'button',
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cx(styles.button, styles[variant], styles[size], className)}
      {...rest}
    >
      <Icon size={size === 'sm' ? 16 : 20} aria-hidden />
      {badge != null && <span className={styles.badge}>{badge}</span>}
    </button>
  );
});

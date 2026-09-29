import { cx } from './cx';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'ghost' | 'danger' | 'inverse';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonStyleProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
}

/** Классы кнопки — для ссылок, которые выглядят как кнопка (например, «Маршрут в Яндекс Картах»). */
export function buttonClassName({
  variant = 'secondary',
  size = 'md',
  fullWidth,
}: ButtonStyleProps = {}): string {
  return cx(styles.button, styles[variant], styles[size], fullWidth && styles.full);
}

export const spinClassName = styles.spin;

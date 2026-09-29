import { LoaderCircle, type LucideIcon } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import {
  buttonClassName,
  spinClassName,
  type ButtonSize,
  type ButtonStyleProps,
  type ButtonVariant,
} from './buttonClassName';
import { cx } from './cx';

export type { ButtonSize, ButtonVariant };

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, ButtonStyleProps {
  icon?: LucideIcon;
  iconRight?: LucideIcon;
  /** Запрос идёт: кнопка неактивна, вместо иконки — индикатор. Двойное нажатие исключено. */
  loading?: boolean;
  children?: ReactNode;
}

/** Кнопка-пилюля дизайн-системы: primary — одна на экран, жёлтая с тёмным текстом. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    fullWidth,
    icon: Icon,
    iconRight: IconRight,
    loading = false,
    disabled,
    className,
    type = 'button',
    children,
    ...rest
  },
  ref,
) {
  const iconSize = size === 'sm' ? 16 : 20;
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(buttonClassName({ variant, size, fullWidth }), className)}
      {...rest}
    >
      {loading ? (
        <LoaderCircle size={iconSize} className={spinClassName} aria-hidden />
      ) : (
        Icon && <Icon size={iconSize} aria-hidden />
      )}
      {children}
      {IconRight && !loading && <IconRight size={iconSize} aria-hidden />}
    </button>
  );
});

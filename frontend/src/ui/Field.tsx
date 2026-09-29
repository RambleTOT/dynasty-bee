import type { LucideIcon } from 'lucide-react';
import { CircleAlert } from 'lucide-react';
import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { ChevronDown } from 'lucide-react';
import { cx } from './cx';
import styles from './Field.module.css';

interface FieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Справа от подписи: «по правилу», «Текстильщики». */
  aside?: ReactNode;
  className?: string;
  children: (id: string, describedBy: string | undefined) => ReactNode;
}

/** Подпись сверху, контрол, подсказка или ошибка снизу (дизайн-система: Field). */
export function Field({ label, hint, error, aside, className, children }: FieldProps) {
  const id = useId();
  const noteId = `${id}-note`;
  const note = error || hint;
  return (
    <div className={cx(styles.field, className)}>
      {(label || aside) && (
        <div className={styles.labelRow}>
          {label && (
            <label htmlFor={id} className={styles.label}>
              {label}
            </label>
          )}
          {aside && <span className={styles.aside}>{aside}</span>}
        </div>
      )}
      {children(id, note ? noteId : undefined)}
      {note && (
        <span id={noteId} className={cx(styles.note, error ? styles.errorNote : undefined)}>
          {error && <CircleAlert size={14} aria-hidden />}
          {note}
        </span>
      )}
    </div>
  );
}

type Tone = 'filled' | 'white';
type Size = 'sm' | 'md';

interface BoxProps {
  icon?: LucideIcon;
  suffix?: ReactNode;
  tone?: Tone;
  size?: Size;
  invalid?: boolean;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}

/** Оболочка поля 48 px (sm — 40), скругление 12, фон nested, рамка 1,5 px в фокусе. */
function ControlBox({
  icon: Icon,
  suffix,
  tone = 'filled',
  size = 'md',
  invalid,
  disabled,
  className,
  children,
}: BoxProps) {
  return (
    <div
      className={cx(
        styles.box,
        styles[tone],
        styles[size],
        invalid && styles.invalid,
        disabled && styles.disabled,
        className,
      )}
    >
      {Icon && <Icon size={18} className={styles.icon} aria-hidden />}
      {children}
      {suffix && <span className={styles.suffix}>{suffix}</span>}
    </div>
  );
}

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  aside?: ReactNode;
  icon?: LucideIcon;
  suffix?: ReactNode;
  tone?: Tone;
  size?: Size;
  /** Элемент в конце поля: кнопка ✕, «глаз». */
  trailing?: ReactNode;
  fieldClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    hint,
    error,
    aside,
    icon,
    suffix,
    tone,
    size,
    trailing,
    fieldClassName,
    className,
    disabled,
    id: ownId,
    ...rest
  },
  ref,
) {
  return (
    <Field label={label} hint={hint} error={error} aside={aside} className={fieldClassName}>
      {(id, describedBy) => (
        <ControlBox
          icon={icon}
          suffix={suffix}
          tone={tone}
          size={size}
          invalid={Boolean(error)}
          disabled={disabled}
          className={className}
        >
          <input
            ref={ref}
            id={ownId ?? id}
            className={styles.input}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            disabled={disabled}
            {...rest}
          />
          {trailing}
        </ControlBox>
      )}
    </Field>
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  fieldClassName?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, fieldClassName, className, id: ownId, ...rest },
  ref,
) {
  return (
    <Field label={label} hint={hint} error={error} className={fieldClassName}>
      {(id, describedBy) => (
        <textarea
          ref={ref}
          id={ownId ?? id}
          className={cx(styles.textarea, error ? styles.invalid : undefined, className)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...rest}
        />
      )}
    </Field>
  );
});

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  'size' | 'onChange' | 'value'
> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  aside?: ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
  size?: Size;
  options: readonly SelectOption[];
  value: string;
  onChange: (value: string) => void;
  /** Пустой пункт в начале: «Выберите». */
  placeholder?: string;
  fieldClassName?: string;
}

/**
 * Выпадающий список. Закрытое состояние — как в дизайн-системе (поле 48 px с шевроном),
 * список — системный: доступен с клавиатуры и на телефоне без своей логики.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  {
    label,
    hint,
    error,
    aside,
    icon,
    tone,
    size,
    options,
    value,
    onChange,
    placeholder,
    fieldClassName,
    className,
    disabled,
    id: ownId,
    ...rest
  },
  ref,
) {
  return (
    <Field label={label} hint={hint} error={error} aside={aside} className={fieldClassName}>
      {(id, describedBy) => (
        <ControlBox
          icon={icon}
          tone={tone}
          size={size}
          invalid={Boolean(error)}
          disabled={disabled}
          className={cx(styles.selectBox, className)}
        >
          <select
            ref={ref}
            id={ownId ?? id}
            className={cx(styles.select, !value && styles.placeholder)}
            value={value}
            disabled={disabled}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            onChange={(event) => onChange(event.target.value)}
            {...rest}
          >
            {placeholder !== undefined && (
              <option value="" disabled>
                {placeholder}
              </option>
            )}
            {options.map((option) => (
              <option key={option.value} value={option.value} disabled={option.disabled}>
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDown size={18} className={styles.chevron} aria-hidden />
        </ControlBox>
      )}
    </Field>
  );
});

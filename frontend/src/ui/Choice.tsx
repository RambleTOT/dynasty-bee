import type { LucideIcon } from 'lucide-react';
import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from './cx';
import styles from './Choice.module.css';

/** Переключатель 40×24 (дизайн-система: Switch). */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <label className={cx(styles.inline, disabled && styles.disabledLabel, className)}>
      <input
        type="checkbox"
        role="switch"
        className={styles.hidden}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className={cx(styles.switch, checked && styles.switchOn)} aria-hidden>
        <span className={styles.knob} />
      </span>
      {label}
    </label>
  );
}

/** Флажок 20 px (дизайн-система: Checkbox). */
export function Checkbox({
  checked,
  onChange,
  label,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <label className={cx(styles.inline, disabled && styles.disabledLabel, className)}>
      <input
        type="checkbox"
        className={styles.hidden}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className={cx(styles.checkbox, checked && styles.checkboxOn)} aria-hidden>
        {checked && <Check size={14} strokeWidth={2.5} />}
      </span>
      {label}
    </label>
  );
}

/** Точка радио 20 px (дизайн-система: Radio). */
export function RadioDot({ checked }: { checked: boolean }) {
  return <span className={cx(styles.radio, checked && styles.radioOn)} aria-hidden />;
}

export interface RadioCardOption<V extends string> {
  value: V;
  label: ReactNode;
  icon?: LucideIcon;
  /** Серая подпись справа: «по справочнику». */
  meta?: ReactNode;
  disabled?: boolean;
}

/**
 * Список крупных радио-строк (шторки инженера, отмена у оператора): выбранная — белая с рамкой 2 px,
 * остальные — на nested-фоне. `dotSide` — точка слева (E-06, O-02) или справа (E-02, E-07, E-08).
 */
export function RadioCards<V extends string>({
  name,
  options,
  value,
  onChange,
  dotSide = 'left',
  plain = false,
  className,
}: {
  name: string;
  options: readonly RadioCardOption<V>[];
  value: V | null;
  onChange: (value: V) => void;
  dotSide?: 'left' | 'right';
  /** Невыбранные строки без подложки (карточка отмены у оператора). */
  plain?: boolean;
  className?: string;
}) {
  return (
    <div role="radiogroup" className={cx(styles.cards, className)}>
      {options.map((option) => {
        const checked = option.value === value;
        const Icon = option.icon;
        return (
          <label
            key={option.value}
            className={cx(
              styles.card,
              plain && styles.plain,
              checked && styles.cardOn,
              option.disabled && styles.disabledLabel,
            )}
          >
            <input
              type="radio"
              name={name}
              className={styles.hidden}
              checked={checked}
              disabled={option.disabled}
              onChange={() => onChange(option.value)}
            />
            {dotSide === 'left' && <RadioDot checked={checked} />}
            {Icon && <Icon size={20} aria-hidden className={styles.cardIcon} />}
            <span className={styles.cardLabel}>{option.label}</span>
            {option.meta && <span className={styles.cardMeta}>{option.meta}</span>}
            {dotSide === 'right' && <RadioDot checked={checked} />}
          </label>
        );
      })}
    </div>
  );
}

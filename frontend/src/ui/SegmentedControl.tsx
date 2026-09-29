import type { LucideIcon } from 'lucide-react';
import { useRef, type KeyboardEvent } from 'react';
import { cx } from './cx';
import styles from './SegmentedControl.module.css';

export interface SegmentOption<V extends string> {
  value: V;
  label: string;
  icon?: LucideIcon;
  /** Счётчик после подписи: «Неназначенные 3». */
  count?: number | null;
  disabled?: boolean;
}

interface SegmentedControlProps<V extends string> {
  options: readonly SegmentOption<V>[];
  value: V;
  onChange: (value: V) => void;
  size?: 'sm' | 'md';
  fullWidth?: boolean;
  /** Подпись группы для скринридера. */
  label?: string;
  className?: string;
}

/** Переключатель-трек: активный сегмент — белая пилюля и тёмный текст (DESIGN_SPEC §2.1 п. 2). */
export function SegmentedControl<V extends string>({
  options,
  value,
  onChange,
  size = 'md',
  fullWidth = false,
  label,
  className,
}: SegmentedControlProps<V>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  // Стрелки влево/вправо переключают сегмент — как у вкладок.
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const step = event.key === 'ArrowRight' ? 1 : -1;
    for (let i = 1; i <= options.length; i += 1) {
      const next = (index + step * i + options.length) % options.length;
      if (!options[next].disabled) {
        onChange(options[next].value);
        refs.current[next]?.focus();
        return;
      }
    }
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      className={cx(styles.track, fullWidth && styles.full, styles[size], className)}
    >
      {options.map((option, index) => {
        const active = option.value === value;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            disabled={option.disabled}
            className={cx(styles.segment, active && styles.active)}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {Icon && <Icon size={16} aria-hidden />}
            {option.label}
            {option.count != null && <span className={styles.count}>{option.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

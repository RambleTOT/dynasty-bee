import { Check, ChevronDown } from 'lucide-react';
import { useId, useRef, useState, type ReactNode } from 'react';
import { cx } from './cx';
import { useDismiss } from './useOverlay';
import styles from './Popover.module.css';

type Placement = 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end';

/** Поповер под элементом-триггером: закрывается кликом снаружи и Esc. */
export function Popover({
  trigger,
  children,
  open: controlledOpen,
  onOpenChange,
  placement = 'bottom-start',
  width,
  className,
}: {
  trigger: (props: { open: boolean; toggle: () => void; id: string }) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  placement?: Placement;
  width?: number;
  className?: string;
}) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = controlledOpen ?? ownOpen;
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();
  const set = (value: boolean) => {
    setOwnOpen(value);
    onOpenChange?.(value);
  };
  useDismiss(open, ref, () => set(false));
  const close = () => set(false);
  return (
    <span ref={ref} className={styles.anchor}>
      {trigger({ open, toggle: () => set(!open), id })}
      {open && (
        <div id={id} className={cx(styles.panel, styles[placement], className)} style={{ width }}>
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </span>
  );
}

/** Тёмная подсказка по наведению и фокусу. */
export function Tooltip({
  label,
  children,
  placement = 'top',
}: {
  label: ReactNode;
  children: ReactNode;
  placement?: 'top' | 'bottom';
}) {
  return (
    <span className={styles.tipAnchor}>
      {children}
      <span role="tooltip" className={cx(styles.tip, styles[`tip_${placement}`])}>
        {label}
      </span>
    </span>
  );
}

export interface MenuOption<V extends string> {
  value: V;
  label: string;
}

/**
 * Фильтр-пилюля (DS-01, DS-03): «Регион · Восток». Выбран не «все» — тёмная пилюля.
 * Один выбор (D-27).
 */
export function FilterPill<V extends string>({
  label,
  options,
  value,
  allValue,
  onChange,
}: {
  label: string;
  options: readonly MenuOption<V>[];
  value: V;
  /** Значение «без фильтра»: тогда пилюля светлая и без подписи значения. */
  allValue?: V;
  onChange: (value: V) => void;
}) {
  const active = allValue === undefined || value !== allValue;
  const current = options.find((option) => option.value === value);
  return (
    <Popover
      width={240}
      trigger={({ open, toggle, id }) => (
        <button
          type="button"
          className={cx(styles.pill, active && allValue !== undefined && styles.pillActive)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={id}
          onClick={toggle}
        >
          {label}
          {active && current && allValue !== undefined ? ` · ${current.label}` : ''}
          <ChevronDown size={16} aria-hidden />
        </button>
      )}
    >
      {(close) => (
        <div role="listbox" aria-label={label} className={styles.menu}>
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selected}
                className={cx(styles.item, selected && styles.itemSelected)}
                onClick={() => {
                  onChange(option.value);
                  close();
                }}
              >
                <span className={styles.itemLabel}>{option.label}</span>
                {selected && <Check size={16} aria-hidden />}
              </button>
            );
          })}
        </div>
      )}
    </Popover>
  );
}

/** Меню действий (⋯): список кнопок в поповере. */
export function ActionMenu({
  trigger,
  items,
  placement = 'bottom-end',
}: {
  trigger: (props: { open: boolean; toggle: () => void; id: string }) => ReactNode;
  items: readonly {
    label: string;
    onSelect: () => void;
    disabled?: boolean;
    danger?: boolean;
    hint?: string;
  }[];
  placement?: Placement;
}) {
  return (
    <Popover trigger={trigger} placement={placement} width={260}>
      {(close) => (
        <div role="menu" className={styles.menu}>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              title={item.hint}
              className={cx(styles.item, item.danger && styles.itemDanger)}
              onClick={() => {
                close();
                item.onSelect();
              }}
            >
              <span className={styles.itemLabel}>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}

import { FilePlus, Zap } from 'lucide-react';
import { useRef, type KeyboardEvent } from 'react';
import { cx } from '@/ui';
import { T } from '../operatorTexts';
import styles from './RequestTabs.module.css';

export type RequestTab = 'regular' | 'emergency';

const TABS = [
  { value: 'regular', label: T.new.tabs.regular, icon: FilePlus },
  { value: 'emergency', label: T.new.tabs.emergency, icon: Zap },
] as const;

/** Вкладки «Обычная заявка» · «Авария» в карточке O-01 (трек 48 px, как в макете). */
export function RequestTabs({
  value,
  onChange,
}: {
  value: RequestTab;
  onChange: (tab: RequestTab) => void;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  // стрелки переключают вкладку, как у SegmentedControl
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const next = (index + (event.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
    onChange(TABS[next].value);
    refs.current[next]?.focus();
  }

  return (
    <div role="tablist" aria-label={T.new.title} className={styles.tabs}>
      {TABS.map((tab, index) => {
        const active = tab.value === value;
        const Icon = tab.icon;
        return (
          <button
            key={tab.value}
            ref={(element) => {
              refs.current[index] = element;
            }}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            className={cx(styles.tab, active && styles.active)}
            onClick={() => onChange(tab.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            <Icon size={18} aria-hidden />
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

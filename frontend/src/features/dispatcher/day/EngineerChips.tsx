/** Чипы бригад (DS-03): «Все бригады · N» и по бригаде — фильтр карты и таймлайна [Д]. */
import type { DayModel } from '@/adapters/dayModel';
import { TRANSPORT_ICON } from '@/lib/dictionaries';
import { formatKm } from '@/lib/format';
import { isTransport } from '@/lib/statuses';
import { cx } from '@/ui';
import styles from './DayPage.module.css';

export function EngineerChips({
  model,
  brigade,
  onSelect,
}: {
  model: DayModel;
  brigade: string | null;
  onSelect: (engineerId: string | null) => void;
}) {
  const hasPlan = Boolean(model.plan);
  return (
    <div className={styles.chips} role="toolbar" aria-label="Бригады">
      <button
        type="button"
        className={cx(styles.chip, !brigade && styles.chipActive)}
        aria-pressed={!brigade}
        onClick={() => onSelect(null)}
      >
        Все бригады · {model.engineers.length}
      </button>
      {model.engineers.map((engineer) => {
        const Icon = isTransport(engineer.transport) ? TRANSPORT_ICON[engineer.transport] : null;
        const active = brigade === engineer.id;
        const meta = !hasPlan ? '' : engineer.used ? `${engineer.taskCount} · ${formatKm(engineer.distanceKm)} км` : '—';
        return (
          <button
            key={engineer.id}
            type="button"
            className={cx(styles.chip, active && styles.chipActive, !engineer.available && styles.chipOff)}
            aria-pressed={active}
            title={engineer.label}
            onClick={() => onSelect(active ? null : engineer.id)}
          >
            <span className={cx(styles.chipDot, styles[`c${engineer.color.index}`])} aria-hidden />
            <span className={styles.chipName}>{engineer.short}</span>
            {Icon && <Icon size={14} className={styles.chipIcon} aria-label={engineer.transportLabel} />}
            {meta && <span className={styles.chipMeta}>{meta}</span>}
          </button>
        );
      })}
    </div>
  );
}

import { memo, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CalendarCell as CalendarCellModel } from '@/adapters/calendar';
import { formatInt } from '@/lib/format';
import { FLAG_ICON, REQUEST_STATUS_ICON } from '@/lib/statuses';
import { Badge, cx } from '@/ui';
import styles from './CalendarCell.module.css';
import tones from './tones.module.css';

const UnassignedIcon = REQUEST_STATUS_ICON.unassigned;
const LateIcon = FLAG_ICON.late;

/**
 * Ячейка месяца (DS-01): число, бейдж «CSV», «N заявок», полоса статусов, «не назначена» /
 * «просрочена», «СЕГОДНЯ». Клик — в день; по наведению и фокусу — подсказка со счётчиками.
 */
export const CalendarCell = memo(function CalendarCell({
  cell,
  to,
}: {
  cell: CalendarCellModel;
  to: string;
}) {
  const [tipOpen, setTipOpen] = useState(false);
  const tipId = useId();
  const tip = tipOpen ? cell.tip : null;

  return (
    <div
      className={styles.slot}
      onMouseEnter={() => setTipOpen(true)}
      onMouseLeave={() => setTipOpen(false)}
    >
      <Link
        to={to}
        className={cx(
          styles.cell,
          !cell.inMonth && styles.outside,
          cell.isPast && styles.past,
          cell.isToday && styles.today,
        )}
        aria-describedby={tip ? tipId : undefined}
        onFocus={() => setTipOpen(true)}
        onBlur={() => setTipOpen(false)}
      >
        <span className={styles.head}>
          <span className={styles.day}>{cell.day}</span>
          {cell.csv && (
            <Badge micro className={styles.csv}>
              CSV
            </Badge>
          )}
          {cell.isToday && <span className={styles.todayLabel}>СЕГОДНЯ</span>}
        </span>
        <span className={styles.count}>{cell.countLabel}</span>
        {cell.segments.length > 0 && (
          <span className={styles.bar} aria-hidden>
            {cell.segments.map((segment) => (
              <span
                key={segment.status}
                className={tones[segment.tone]}
                style={{ flexGrow: segment.count }}
              />
            ))}
          </span>
        )}
        {(cell.unassignedLabel || cell.lateLabel) && (
          <span className={styles.problems}>
            {cell.unassignedLabel && (
              <span className={styles.problem}>
                <UnassignedIcon size={14} aria-hidden />
                {cell.unassignedLabel}
              </span>
            )}
            {cell.lateLabel && (
              <span className={styles.problem}>
                <LateIcon size={14} aria-hidden />
                {cell.lateLabel}
              </span>
            )}
          </span>
        )}
      </Link>
      {tip && (
        <div
          role="tooltip"
          id={tipId}
          className={cx(styles.tip, cell.weekday >= 6 && styles.tipEnd)}
        >
          <div className={styles.tipTitle}>{tip.title}</div>
          {tip.rows.map((row) => (
            <div key={row.key} className={styles.tipRow}>
              <span className={cx(styles.tipDot, tones[row.tone])} aria-hidden />
              <span className={styles.tipLabel}>{row.label}</span>
              <span>{formatInt(row.count)}</span>
            </div>
          ))}
          {tip.regions.length > 0 && (
            <>
              <div className={styles.tipSection}>По регионам</div>
              {tip.regions.map((row) => (
                <div key={row.regionId} className={styles.tipRow}>
                  <span className={styles.tipLabel}>{row.label}</span>
                  <span>
                    {formatInt(row.count)}
                    {row.unassigned > 0 && (
                      <span className={styles.tipDanger}> · {formatInt(row.unassigned)} не назн.</span>
                    )}
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
});

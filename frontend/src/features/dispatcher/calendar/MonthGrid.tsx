import { CalendarX2 } from 'lucide-react';
import type { CalendarMonth } from '@/adapters/calendar';
import { cx, Skeleton } from '@/ui';
import { CalendarCell } from './CalendarCell';
import styles from './CalendarPage.module.css';

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

export function WeekdayHeader() {
  return (
    <div className={styles.weekdays} aria-hidden>
      {WEEKDAYS.map((day) => (
        <span key={day}>{day}</span>
      ))}
    </div>
  );
}

/** Загрузка — скелетоны ячеек (DS-01). */
export function SkeletonGrid({ cells }: { cells: number }) {
  return (
    <div className={styles.grid} role="status" aria-label="Загрузка календаря">
      {Array.from({ length: cells }, (_, index) => (
        <div key={index} className={styles.skeletonCell}>
          <Skeleton width={24} height={12} />
          <Skeleton width="70%" height={16} />
          <Skeleton height={6} radius="var(--radius-pill)" />
        </div>
      ))}
    </div>
  );
}

/** Сетка месяца 7×N; пустой месяц — ячейки с «—» и карточка «В этом месяце заявок нет». */
export function MonthGrid({
  model,
  dayHref,
}: {
  model: CalendarMonth;
  dayHref: (date: string) => string;
}) {
  return (
    <>
      <div className={cx(styles.grid, model.empty && styles.gridEmpty)}>
        {model.cells.map((cell) => (
          <CalendarCell key={cell.date} cell={cell} to={dayHref(cell.date)} />
        ))}
      </div>
      {model.empty && (
        <div className={styles.emptyCard}>
          <CalendarX2 size={24} className={styles.emptyIcon} aria-hidden />
          <div className={styles.emptyTitle}>В этом месяце заявок нет</div>
          <div className={styles.emptyText}>Загрузите CSV или дождитесь записей оператора</div>
        </div>
      )}
    </>
  );
}

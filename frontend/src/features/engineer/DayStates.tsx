import { CalendarCheck, CalendarClock } from 'lucide-react';
import { EmptyState, ErrorState, Skeleton } from '@/ui';
import styles from './VisitList.module.css';

/** Загрузка (§9.1): скелетоны карточки текущей заявки и 4 строк. */
export function DaySkeleton() {
  return (
    <div className={styles.stack} aria-busy="true" aria-label="Загрузка">
      <Skeleton height={40} radius="var(--radius-pill)" />
      <div className={styles.card}>
        <Skeleton width={120} height={14} />
        <Skeleton width="70%" height={28} />
        <Skeleton width="85%" height={22} />
        <Skeleton height={48} radius="var(--radius-pill)" />
      </div>
      <div className={styles.list}>
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className={styles.skeletonRow}>
            <Skeleton width={24} height={24} radius="var(--radius-pill)" />
            <div className={styles.skeletonText}>
              <Skeleton width="80%" height={16} />
              <Skeleton width="55%" height={14} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Ошибка сети (§9.1, DESIGN_SPEC §7.5). */
export function DayError({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  return (
    <div className={styles.card}>
      <ErrorState message="Не удалось связаться с сервером" onRetry={onRetry} retrying={retrying} />
    </div>
  );
}

/** План не опубликован (§9.1). */
export function PlanNotPublished() {
  return (
    <div className={styles.card}>
      <EmptyState icon={CalendarClock} title="План на сегодня ещё не опубликован">
        Он появится, когда диспетчер начнёт рабочий день
      </EmptyState>
    </div>
  );
}

/** Заявок нет (§9.1). */
export function NoVisits() {
  return (
    <div className={styles.card}>
      <EmptyState icon={CalendarCheck} title="На сегодня заявок нет" />
    </div>
  );
}

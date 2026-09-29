import { CircleCheck } from 'lucide-react';
import { shiftSummary, type EngineerDayModel } from '@/adapters/engineerDay';
import { formatDayTitle, formatDuration, formatKm } from '@/lib/format';
import { cx } from '@/ui';
import styles from './ShiftSummary.module.css';

/**
 * «Пн, 29 сентября · 10:00–21:35» — по факту ⏳ 8.7, иначе «… · смена 10:00–22:00».
 */
function subtitle(day: EngineerDayModel, startedAt: string | null, endedAt: string | null) {
  const { shiftStart, shiftEnd } = day.engineer;
  const period =
    startedAt && endedAt
      ? `${startedAt}–${endedAt}`
      : shiftStart && shiftEnd
        ? `смена ${shiftStart}–${shiftEnd}`
        : null;
  return [day.date && formatDayTitle(day.date), period].filter(Boolean).join(' · ');
}

/**
 * E-10 «Итоги смены» по `shift_totals`; их нет — «Выполнено» и «Прервано» по визитам, остальное
 * «—» (§9.2). Кнопка «Выйти» — внизу экрана.
 */
export function ShiftSummary({ day }: { day: EngineerDayModel }) {
  const s = shiftSummary(day);
  const tiles = [
    { label: 'Выполнено', value: `${s.done} из ${s.total}` },
    {
      label: 'Начато в окне',
      value: s.startedInWindow == null ? '—' : `${s.startedInWindow} из ${s.done}`,
    },
    { label: 'Пробег', value: s.km == null ? '—' : `${formatKm(s.km)} км` },
    { label: 'Прервано', value: String(s.interrupted) },
    { label: 'В дороге', value: formatDuration(s.minutesTravel) },
    { label: 'В работе', value: formatDuration(s.minutesWork) },
    { label: 'В ожидании', value: formatDuration(s.minutesWait), wide: true },
  ];
  const sub = subtitle(day, s.startedAt, s.endedAt);
  return (
    <>
      <section className={styles.head} aria-labelledby="shift-summary-title">
        <CircleCheck size={28} className={styles.icon} aria-hidden />
        <h1 id="shift-summary-title" className={styles.title}>
          Смена завершена
        </h1>
        {sub && <p className={styles.subtitle}>{sub}</p>}
      </section>
      <dl className={styles.grid} aria-label="Итоги смены">
        {tiles.map((tile) => (
          <div key={tile.label} className={cx(styles.tile, tile.wide && styles.wide)}>
            <dt className={styles.label}>{tile.label}</dt>
            <dd className={styles.value}>{tile.value}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

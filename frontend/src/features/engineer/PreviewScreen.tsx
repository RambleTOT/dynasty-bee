import { Building2, ChevronRight, House } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  isClosedStatus,
  type EngineerDayModel,
  type EngineerVisitModel,
} from '@/adapters/engineerDay';
import { countOf, formatDayMonth, PL_REQUEST } from '@/lib/format';
import { UrgentFlag } from '@/ui';
import { visitPath } from './paths';
import { AddressText, EquipmentLine } from './VisitBits';
import styles from './PreviewScreen.module.css';

/** «Старт: офис, ул. …» (§9.2 E-01); адреса старта нет — «Старт: офис». */
function startLabel(start: EngineerDayModel['engineer']['start']): string | null {
  if (!start) return null;
  const kind = start.kind === 'office' ? 'офис' : start.kind === 'home' ? 'дом' : null;
  const text = [kind, start.address].filter(Boolean).join(', ');
  return text ? `Старт: ${text}` : null;
}

/** «Прибытие ≈ 10:20 · 70 мин · окно 10–12». */
function stopMeta(visit: EngineerVisitModel): string {
  return [
    visit.arrival && `Прибытие ≈ ${visit.arrival}`,
    visit.durationMin != null && `${visit.durationMin} мин`,
    visit.windowShort && `окно ${visit.windowShort}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * E-01 «Превью до начала смены» — «Список»: карточка дня и лента заявок по времени прибытия.
 * Каждая заявка открывает свою карточку (действий в ней до начала смены нет).
 * Кнопки «Начать смену» / «Не выйду сегодня» — в нижней панели экрана.
 */
export function PreviewScreen({ day }: { day: EngineerDayModel }) {
  const start = startLabel(day.engineer.start);
  const StartIcon = day.engineer.start?.kind === 'home' ? House : Building2;
  const stops = day.visits.filter((visit) => !isClosedStatus(visit.status));
  return (
    <>
      <section className={styles.summary} aria-label="Сегодня">
        <h2 className={styles.summaryTitle}>
          {day.date ? `Сегодня, ${formatDayMonth(day.date)}` : 'Сегодня'}
        </h2>
        <p className={styles.summaryText}>
          {countOf(day.total, PL_REQUEST)}
          {day.firstStart && `, первая в ${day.firstStart}`}
        </p>
        {start && (
          <p className={styles.start}>
            <StartIcon size={16} aria-hidden />
            {start}
          </p>
        )}
      </section>
      <ol className={styles.timeline} aria-label="Заявки по времени">
        {stops.map((visit) => (
          <li key={visit.id} className={styles.stop}>
            <div className={styles.rail}>
              <span className={styles.railTime}>{visit.arrival ?? visit.start ?? '—'}</span>
              <span className={styles.railLine} aria-hidden />
            </div>
            <Link to={visitPath(visit.id)} className={styles.stopCard}>
              <div className={styles.stopHead}>
                <span className={styles.stopTitle}>{visit.title}</span>
                {visit.flags.includes('urgent') && <UrgentFlag size="sm" />}
                <ChevronRight size={18} className={styles.stopChevron} aria-hidden />
              </div>
              <div className={styles.stopMeta}>{stopMeta(visit)}</div>
              <div className={styles.stopAddress}>
                <AddressText address={visit.address} />
              </div>
              <EquipmentLine equipment={visit.equipment} />
            </Link>
          </li>
        ))}
      </ol>
    </>
  );
}

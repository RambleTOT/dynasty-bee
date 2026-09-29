import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { formatDayTitle, formatMonthTitle } from '@/lib/format';
import { addMonths, monthGrid, monthOf } from '@/lib/time';
import { cx, IconButton, Modal } from '@/ui';
import { T } from '../operatorTexts';
import styles from './CalendarModal.module.css';

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

/**
 * Календарь даты записи и переноса — месяц сеткой, как календарь диспетчера (DS-01): листать
 * месяцы, прошедшие дни не выбрать, сегодня — рамкой, выбранный — тёмный.
 */
export function CalendarModal({
  value,
  min,
  onPick,
  onClose,
}: {
  value: string;
  /** Сегодня: раньше не выбрать. */
  min: string;
  onPick: (date: string) => void;
  onClose: () => void;
}) {
  const [month, setMonth] = useState(() => monthOf(value >= min ? value : min));
  const title = formatMonthTitle(month);
  return (
    <Modal open width={480} title={T.slots.calendarTitle} onClose={onClose}>
      <div className={styles.head}>
        <IconButton
          icon={ChevronLeft}
          label={T.slots.prevMonth}
          variant="secondary"
          size="sm"
          disabled={month <= monthOf(min)}
          onClick={() => setMonth(addMonths(month, -1))}
        />
        <span className={styles.title} aria-live="polite">
          {title}
        </span>
        <IconButton
          icon={ChevronRight}
          label={T.slots.nextMonth}
          variant="secondary"
          size="sm"
          onClick={() => setMonth(addMonths(month, 1))}
        />
      </div>
      <div className={styles.weekdays} aria-hidden>
        {WEEKDAYS.map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className={styles.grid} role="group" aria-label={title}>
        {monthGrid(month).map((day) => (
          <button
            key={day}
            type="button"
            className={cx(
              styles.cell,
              monthOf(day) !== month && styles.outside,
              day === min && styles.today,
              day === value && styles.selected,
            )}
            disabled={day < min}
            aria-pressed={day === value}
            aria-label={formatDayTitle(day)}
            onClick={() => onPick(day)}
          >
            {Number(day.slice(8, 10))}
          </button>
        ))}
      </div>
    </Modal>
  );
}

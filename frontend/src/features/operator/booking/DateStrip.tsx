import { CalendarDays } from 'lucide-react';
import { useState } from 'react';
import { dateWithWeekday, dayOfMonth, weekdayShort } from '@/lib/booking';
import { formatMonthName } from '@/lib/format';
import { addDays } from '@/lib/time';
import { cx, IconButton } from '@/ui';
import { T } from '../operatorTexts';
import { CalendarModal } from './CalendarModal';
import { monthSegments, STRIP_DAYS, stripStart } from './stripDays';
import styles from './DateStrip.module.css';

/**
 * Лента дат шага «Дата и окно» (FRONTEND_SPEC §8.3.8): две недели пилюлями 56 px, над ними —
 * название месяца, в конце — календарь на любой день (запись и перенос дальше двух недель).
 */
export function DateStrip({
  value,
  onChange,
  today,
  disabled = false,
}: {
  value: string;
  onChange: (date: string) => void;
  /** Раньше этого дня не выбрать. */
  today: string;
  disabled?: boolean;
}) {
  const [start, setStart] = useState(() => stripStart(value, today));
  const [calendar, setCalendar] = useState(false);
  // дату сменили снаружи на ту, что не в ленте, — лента к ней
  const inStrip = value >= start && value <= addDays(start, STRIP_DAYS - 1);
  const first = inStrip ? start : stripStart(value, today);
  const days = Array.from({ length: STRIP_DAYS }, (_, index) => addDays(first, index));

  return (
    <div className={styles.wrap}>
      <div className={styles.strip} role="group" aria-label={T.slots.dates}>
        {monthSegments(days).map((segment) => (
          <span
            key={segment.month}
            className={styles.month}
            style={{ gridColumn: `${segment.from + 1} / span ${segment.span}` }}
          >
            {formatMonthName(segment.month)}
          </span>
        ))}
        {days.map((day, index) => {
          const active = day === value;
          return (
            <button
              key={day}
              type="button"
              className={cx(styles.day, active && styles.active)}
              style={{ gridColumn: index + 1 }}
              aria-pressed={active}
              aria-label={dateWithWeekday(day)}
              disabled={disabled}
              onClick={() => onChange(day)}
            >
              <span className={styles.weekday}>{weekdayShort(day)}</span>
              <span className={styles.number}>{dayOfMonth(day)}</span>
            </button>
          );
        })}
        <IconButton
          icon={CalendarDays}
          label={T.slots.calendar}
          variant="secondary"
          size="lg"
          className={styles.calendar}
          disabled={disabled}
          onClick={() => setCalendar(true)}
        />
      </div>
      {calendar && (
        <CalendarModal
          value={value}
          min={today}
          onPick={(day) => {
            setCalendar(false);
            setStart(stripStart(day, today));
            onChange(day);
          }}
          onClose={() => setCalendar(false)}
        />
      )}
    </div>
  );
}

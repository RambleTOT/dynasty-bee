import { CircleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import type { SlotView } from '@/adapters/booking';
import { Callout, Card } from '@/ui';
import { T } from '../operatorTexts';
import { DateStrip } from './DateStrip';
import { SlotGrid, type SlotsStatus } from './SlotGrid';
import styles from './SlotStep.module.css';

/**
 * Правая карточка «Дата и окно» — общая для записи (O-01.2) и переноса (O-02.1): лента дат,
 * сетка окон, плашка SLOT_TAKEN над кнопками, кнопки внизу справа.
 */
export function SlotStep({
  caption,
  note,
  today,
  date,
  onDateChange,
  status,
  slots,
  selected,
  onSelect,
  onRetry,
  retrying,
  taken,
  actions,
}: {
  caption: string;
  /** Строка над сеткой: «Сейчас: 29.09, 18–20» у переноса. */
  note?: ReactNode;
  /** Раньше этого дня дату не выбрать. */
  today: string;
  date: string;
  onDateChange: (date: string) => void;
  status: SlotsStatus;
  slots: readonly SlotView[];
  selected: string | null;
  onSelect: (window: string) => void;
  onRetry: () => void;
  retrying: boolean;
  /** 409 SLOT_TAKEN: «Это окно только что заняли». */
  taken: boolean;
  actions: ReactNode;
}) {
  return (
    <Card className={styles.card}>
      <div className={styles.head}>
        <h2 className={styles.title}>{T.slots.title}</h2>
        <span className={styles.caption}>{caption}</span>
      </div>
      <DateStrip value={date} onChange={onDateChange} today={today} />
      {note && <p className={styles.note}>{note}</p>}
      <SlotGrid
        status={status}
        slots={slots}
        selected={selected}
        onSelect={onSelect}
        onRetry={onRetry}
        retrying={retrying}
        date={date}
      />
      {taken && (
        <Callout tone="danger" icon={CircleAlert} className={styles.taken}>
          {T.slots.taken}
        </Callout>
      )}
      <div className={styles.actions}>{actions}</div>
    </Card>
  );
}

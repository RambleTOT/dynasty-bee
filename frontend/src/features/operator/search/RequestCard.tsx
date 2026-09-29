import { CalendarClock } from 'lucide-react';
import { bookingKey, type BookingItem } from '@/adapters/booking';
import { dateWithWeekday, typeFull, windowFull } from '@/lib/booking';
import { knownRegionName } from '@/lib/regions';
import { Button, InfoGrid, StatusChip, type InfoItem } from '@/ui';
import { T } from '../operatorTexts';
import { CancelBlock } from './CancelBlock';
import styles from './RequestCard.module.css';

/** Поля карточки: чего нет в ответе (⏳ 9.2), не выводим. */
function infoItems(item: BookingItem): (InfoItem | false)[] {
  const type = typeFull(item.typeBk, item.typeHd);
  const region = knownRegionName(item.regionId);
  return [
    region !== null && { label: T.card.region, value: region },
    {
      label: T.card.dateWindow,
      value: `${dateWithWeekday(item.date)} · ${windowFull(item.window)}`,
    },
    Boolean(type) && { label: T.card.type, value: type },
    { label: T.card.address, value: item.address || T.card.noAddress },
    item.district !== undefined && { label: T.card.district, value: item.district },
    item.gigabit !== undefined && {
      label: T.card.gigabit,
      value: item.gigabit ? T.card.yes : T.card.no,
    },
    item.engineerName !== undefined && {
      label: T.card.engineer,
      value: item.engineerName ?? T.card.engineerNone,
    },
  ];
}

/**
 * Правая карточка O-02. «Перенести» и «Отменить» — у любой заявки: статус не проверяем,
 * допустимость решает бэк (D-34, ⏳ 9.9).
 */
export function RequestCard({
  item,
  cancelOpen,
  onReschedule,
  onCancelOpen,
  onCancelClose,
}: {
  item: BookingItem;
  cancelOpen: boolean;
  onReschedule: () => void;
  onCancelOpen: () => void;
  onCancelClose: () => void;
}) {
  return (
    <>
      <div className={styles.head}>
        <h2 className={styles.id}>№{item.id}</h2>
        {item.status && <StatusChip status={item.status} />}
      </div>
      <InfoGrid items={infoItems(item)} />
      <div className={styles.actions}>
        <Button variant="tertiary" icon={CalendarClock} onClick={onReschedule}>
          {T.card.reschedule}
        </Button>
        <Button variant="danger" onClick={onCancelOpen} aria-expanded={cancelOpen}>
          {T.card.cancel}
        </Button>
      </div>
      {cancelOpen && <CancelBlock key={bookingKey(item)} item={item} onClose={onCancelClose} />}
    </>
  );
}

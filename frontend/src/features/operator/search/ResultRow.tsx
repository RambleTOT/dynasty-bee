import type { BookingItem } from '@/adapters/booking';
import { dateShort, typeShort, windowShort } from '@/lib/booking';
import { knownRegionName } from '@/lib/regions';
import { cx, StatusChip } from '@/ui';
import { T } from '../operatorTexts';
import styles from './ResultRow.module.css';

/** «Юго-восток · 29.09 · окно 18–20 · Подключение»: номера в разных регионах и днях совпадают. */
function metaOf(item: BookingItem): string {
  return [
    knownRegionName(item.regionId),
    dateShort(item.date),
    T.search.window(windowShort(item.window)),
    typeShort(item.typeBk, item.typeHd),
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Строка результата поиска: выбранная — белая с рамкой 2 px, остальные — на nested-фоне. */
export function ResultRow({
  item,
  selected,
  onSelect,
}: {
  item: BookingItem;
  selected: boolean;
  onSelect: (item: BookingItem) => void;
}) {
  return (
    <button
      type="button"
      className={cx(styles.row, selected && styles.selected)}
      aria-pressed={selected}
      onClick={() => onSelect(item)}
    >
      <span className={styles.top}>
        <span className={styles.id}>№{item.id}</span>
        {item.status && <StatusChip status={item.status} size="sm" />}
      </span>
      <span className={cx(styles.address, !item.address && styles.muted)}>
        {item.address || T.card.noAddress}
      </span>
      <span className={styles.meta}>{metaOf(item)}</span>
    </button>
  );
}

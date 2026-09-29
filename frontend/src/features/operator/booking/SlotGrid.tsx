import type { SlotView } from '@/adapters/booking';
import { dateShort, windowShort } from '@/lib/booking';
import { Callout, cx, ErrorState, Skeleton } from '@/ui';
import { T } from '../operatorTexts';
import styles from './SlotGrid.module.css';

export type SlotsStatus = 'loading' | 'error' | 'ready';

/** Скелетонов при загрузке — как окон в типичном дне; сами окна берём из ответа. */
const SKELETONS = 6;

type SlotKind = 'free' | 'busy' | 'selected';

const KIND_LABEL: Record<SlotKind, string> = {
  free: T.slots.free,
  busy: T.slots.busy,
  selected: T.slots.selected,
};

/**
 * Сетка окон — 3 в ряд, из `slots[]` ответа (6 окон не зашиваем). Свободные — белые, занятые —
 * тусклые и не нажимаются, причины не показываем (D-22).
 */
export function SlotGrid({
  status,
  slots,
  selected,
  onSelect,
  onRetry,
  retrying,
  date,
}: {
  status: SlotsStatus;
  slots: readonly SlotView[];
  selected: string | null;
  onSelect: (window: string) => void;
  onRetry: () => void;
  retrying: boolean;
  date: string;
}) {
  if (status === 'loading') {
    return (
      <div className={styles.grid} aria-busy="true">
        {Array.from({ length: SKELETONS }, (_, index) => (
          <Skeleton key={index} height={104} radius="var(--radius-lg)" />
        ))}
      </div>
    );
  }

  if (status === 'error') {
    return <ErrorState message={T.slots.error} onRetry={onRetry} retrying={retrying} />;
  }

  const anyFree = slots.some((slot) => slot.available);
  return (
    <>
      {slots.length > 0 && (
        <div className={styles.grid} role="group" aria-label={T.slots.windows}>
          {slots.map((slot) => {
            const kind: SlotKind =
              slot.window === selected && slot.available
                ? 'selected'
                : slot.available
                  ? 'free'
                  : 'busy';
            return (
              <button
                key={slot.window}
                type="button"
                className={cx(styles.slot, styles[kind])}
                disabled={!slot.available}
                aria-pressed={kind === 'selected'}
                onClick={() => onSelect(slot.window)}
              >
                <span className={styles.time}>{windowShort(slot.window)}</span>
                <span className={styles.state}>{KIND_LABEL[kind]}</span>
              </button>
            );
          })}
        </div>
      )}
      {!anyFree && <Callout>{T.slots.none(dateShort(date))}</Callout>}
    </>
  );
}

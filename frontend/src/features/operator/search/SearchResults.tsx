import { SearchX, TextSearch } from 'lucide-react';
import { bookingKey, type BookingItem } from '@/adapters/booking';
import { EmptyState, ErrorState, Skeleton } from '@/ui';
import { T } from '../operatorTexts';
import { ResultRow } from './ResultRow';
import styles from './SearchResults.module.css';

export type SearchState = 'short' | 'loading' | 'error' | 'list';

/** Лимит ответа поиска на бэке. */
export const SEARCH_LIMIT = 20;

/** Левая колонка O-02 под полем поиска: подсказка и строки или состояние (§8.3.6). */
export function SearchResults({
  state,
  items,
  selectedKey,
  onSelect,
  onRetry,
  retrying,
}: {
  state: SearchState;
  items: readonly BookingItem[];
  /** `bookingKey` выбранной: номер, регион и день — номера в разных днях совпадают. */
  selectedKey: string | null;
  onSelect: (item: BookingItem) => void;
  onRetry: () => void;
  retrying: boolean;
}) {
  if (state === 'short') return <EmptyState icon={TextSearch} title={T.search.empty} />;

  if (state === 'loading') {
    return (
      <div className={styles.list} aria-busy="true">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} height={88} radius="var(--radius-md)" />
        ))}
      </div>
    );
  }

  if (state === 'error') {
    return <ErrorState message={T.net.error} onRetry={onRetry} retrying={retrying} />;
  }

  if (items.length === 0) return <EmptyState icon={SearchX} title={T.search.notFound} />;

  return (
    <>
      <div className={styles.hint}>
        <span>{T.search.hint(items.length)}</span>
        {items.length >= SEARCH_LIMIT && <span>{T.search.limit}</span>}
      </div>
      <div className={styles.list}>
        {items.map((item) => (
          <ResultRow
            key={bookingKey(item)}
            item={item}
            selected={bookingKey(item) === selectedKey}
            onSelect={onSelect}
          />
        ))}
      </div>
    </>
  );
}

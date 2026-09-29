import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query';
import { MousePointerClick, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { bookingKey, findExact, normalizeSearch, searchQueries } from '@/adapters/booking';
import { searchRequests } from '@/api/booking';
import { queryKeys } from '@/api/queryKeys';
import { searchParam, useSearchState } from '@/hooks/useSearchState';
import { Card, EmptyState, ErrorState, IconButton, Input, Skeleton } from '@/ui';
import { rescheduleUrl, type RescheduleState } from '../navigation';
import { T } from '../operatorTexts';
import { useDebouncedValue } from '../useDebouncedValue';
import { RequestCard } from './RequestCard';
import { SearchResults, type SearchState } from './SearchResults';
import styles from './SearchPage.module.css';

/** Поиск — от 3 символов, после паузы 300 мс; ответ свежий 10 с (FRONTEND_SPEC §8.3.4). */
const MIN_QUERY = 3;
const SEARCH_STALE_MS = 10_000;

/** `request` — номер, `region` и `date` — день заявки: номера повторяются в разных днях и регионах. */
const searchSchema = {
  q: searchParam.string(''),
  request: searchParam.string(),
  region: searchParam.string(),
  date: searchParam.string(),
  cancel: searchParam.enum(['1']),
};

const searchQuery = (q: string) =>
  queryOptions({
    queryKey: queryKeys.bookingSearch(q),
    // «ВК-…» русскими и номер без «BK-» — ещё одним запросом (searchQueries)
    queryFn: async ({ signal }) =>
      (await Promise.all(searchQueries(q).map((query) => searchRequests(query, signal)))).flat(),
    staleTime: SEARCH_STALE_MS,
    select: normalizeSearch,
  });

/** O-02 «Найти заявку»: поиск слева, карточка и отмена справа (FRONTEND_SPEC §8.3.6). */
export default function SearchPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useSearchState(searchSchema);
  const [text, setText] = useState(search.q);
  const typed = useDebouncedValue(text.trim(), 300);
  // очищенное поле — сразу, без паузы
  const q = text.trim() === '' ? '' : typed;
  const active = q.length >= MIN_QUERY;

  // строка поиска — в адресе: к ней возвращаемся из переноса и после перезагрузки
  useEffect(() => {
    if (q !== search.q) setSearch({ q });
  }, [q, search.q, setSearch]);

  const results = useQuery({
    ...searchQuery(q),
    enabled: active,
    // пока идёт новый поиск, карточка справа не мигает; слева при этом — скелетоны
    placeholderData: keepPreviousData,
  });

  // Карточка — заявка из списка. Без строки поиска (вернулись из переноса, ссылка) — ищем по номеру.
  const requestId = search.request;
  const lookup = useQuery({ ...searchQuery(requestId ?? ''), enabled: !active && !!requestId });
  const selected = findExact(active ? results.data : lookup.data, requestId, {
    regionId: search.region,
    date: search.date,
  });

  const state: SearchState = !active
    ? 'short'
    : results.isError
      ? 'error'
      : results.isPending || results.isPlaceholderData
        ? 'loading'
        : 'list';

  function clear() {
    setText('');
    setSearch({ q: '', request: null, region: null, date: null, cancel: null });
  }

  let card;
  if (selected) {
    card = (
      <RequestCard
        item={selected}
        cancelOpen={search.cancel === '1'}
        onReschedule={() => {
          const back: RescheduleState = { item: selected, q };
          navigate(rescheduleUrl(selected), { state: back });
        }}
        onCancelOpen={() => setSearch({ cancel: '1' })}
        onCancelClose={() => setSearch({ cancel: null })}
      />
    );
  } else if (!active && requestId && lookup.isPending) {
    card = (
      <div className={styles.cardLoading} aria-busy="true">
        <Skeleton width={240} height={28} />
        <Skeleton height={180} radius="var(--radius-lg)" />
      </div>
    );
  } else if (!active && requestId && lookup.isError) {
    card = (
      <ErrorState
        className={styles.center}
        message={T.net.error}
        onRetry={() => void lookup.refetch()}
        retrying={lookup.isFetching}
      />
    );
  } else {
    card = <EmptyState className={styles.center} icon={MousePointerClick} title={T.card.none} />;
  }

  return (
    <div className={styles.page}>
      <Card className={styles.left}>
        <h2 className={styles.title}>{T.search.title}</h2>
        <Input
          icon={Search}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={T.search.placeholder}
          aria-label={T.search.title}
          autoComplete="off"
          autoFocus
          trailing={
            text ? (
              <IconButton
                icon={X}
                label={T.search.clear}
                variant="ghost"
                size="sm"
                className={styles.clear}
                onClick={clear}
              />
            ) : null
          }
        />
        <SearchResults
          state={state}
          items={results.data ?? []}
          selectedKey={selected ? bookingKey(selected) : null}
          onSelect={(item) =>
            setSearch({ request: item.id, region: item.regionId, date: item.date, cancel: null })
          }
          onRetry={() => void results.refetch()}
          retrying={results.isFetching}
        />
      </Card>
      <Card className={styles.right}>{card}</Card>
    </div>
  );
}

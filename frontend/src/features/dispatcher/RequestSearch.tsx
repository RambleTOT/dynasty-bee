/**
 * Поиск заявки по номеру в шапке диспетчера: день и регион заявки неизвестны — ищем по всем дням
 * (`GET /booking/requests`, как у оператора), выбор открывает день заявки с её карточкой (`pin`).
 * Номер «ВК-…» русскими и без «BK-» — ещё одним запросом (adapters/booking.ts, searchQueries).
 */
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { normalizeSearch, searchQueries, type BookingItem } from '@/adapters/booking';
import { searchRequests } from '@/api/booking';
import { queryKeys } from '@/api/queryKeys';
import { dateShort } from '@/lib/booking';
import { regionLabel } from '@/lib/dictionaries';
import { REQUEST_STATUS_LABEL } from '@/lib/statuses';
import { windowShort } from '@/lib/time';
import { cx, Input, Spinner } from '@/ui';
import styles from './RequestSearch.module.css';

const MIN_QUERY = 3;
const SHOWN = 8;

const windowOf = (window: string) => {
  const [start, end] = window.split('-');
  return start && end ? windowShort(start, end) : window;
};

export function RequestSearch() {
  const navigate = useNavigate();
  const listId = useId();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(timer);
  }, [text]);

  const enabled = q.length >= MIN_QUERY;
  const results = useQuery({
    queryKey: queryKeys.bookingSearch(q),
    queryFn: async ({ signal }) =>
      (await Promise.all(searchQueries(q).map((query) => searchRequests(query, signal)))).flat(),
    select: normalizeSearch,
    enabled,
    staleTime: 10_000,
  });
  const items = enabled && open ? (results.data ?? []).slice(0, SHOWN) : [];
  const shown = open && enabled && text.trim().length >= MIN_QUERY;

  const pick = (item: BookingItem) => {
    setOpen(false);
    setActive(-1);
    setText('');
    const params = new URLSearchParams();
    if (item.regionId) params.set('region', item.regionId);
    params.set('pin', item.id);
    navigate(`/dispatcher/day/${item.date}?${params}`);
  };

  return (
    <div className={styles.wrap}>
      <Input
        size="sm"
        tone="filled"
        icon={Search}
        placeholder="Найти заявку по номеру"
        aria-label="Найти заявку по номеру"
        value={text}
        autoComplete="off"
        role="combobox"
        aria-expanded={shown}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={shown && active >= 0 ? `${listId}-${active}` : undefined}
        onChange={(event) => {
          setText(event.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setOpen(false);
            return;
          }
          if (!items.length) return;
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActive((index) => (index + 1) % items.length);
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((index) => (index <= 0 ? items.length - 1 : index - 1));
          } else if (event.key === 'Enter') {
            event.preventDefault();
            pick(items[active >= 0 ? active : 0]);
          }
        }}
      />
      {shown && (
        <ul id={listId} role="listbox" aria-label="Найденные заявки" className={styles.list}>
          {results.isPending || (results.isFetching && !results.data) ? (
            <li className={styles.empty}>
              <Spinner size={16} label="Ищем" /> Ищем…
            </li>
          ) : results.isError ? (
            <li className={styles.empty}>Не удалось найти. Повторите</li>
          ) : items.length === 0 ? (
            <li className={styles.empty}>Заявки с таким номером нет</li>
          ) : (
            items.map((item, index) => (
              <li
                key={`${item.id}|${item.regionId}|${item.date}`}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                className={cx(styles.option, index === active && styles.active)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  pick(item);
                }}
                onMouseEnter={() => setActive(index)}
              >
                <span className={styles.head}>
                  <span className={styles.number}>№{item.id}</span>
                  {item.status && <span className={styles.status}>{REQUEST_STATUS_LABEL[item.status]}</span>}
                </span>
                <span className={styles.sub}>
                  {[
                    item.regionId ? regionLabel(item.regionId) : null,
                    item.date ? dateShort(item.date) : null,
                    item.window ? `окно ${windowOf(item.window)}` : null,
                    item.address || null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

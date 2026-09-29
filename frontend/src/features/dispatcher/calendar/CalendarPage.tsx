import { useQueries, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback, useMemo, type CSSProperties } from 'react';
import {
  buildCalendarMonth,
  calendarRange,
  calendarSummary,
  summaryRegionCount,
} from '@/adapters/calendar';
import { getCalendar } from '@/api/calendar';
import { isApiError } from '@/api/errors';
import { queryKeys } from '@/api/queryKeys';
import { useAuth } from '@/auth/useAuth';
import { POLL } from '@/config';
import { useRegions } from '@/hooks/useRegions';
import { useSearchState } from '@/hooks/useSearchState';
import { usePollInterval } from '@/realtime/useRealtime';
import { BK } from '@/lib/dictionaries';
import { formatMonthTitle } from '@/lib/format';
import { addMonths, monthGrid, monthOf, todayMsk } from '@/lib/time';
import { Button, cx, ErrorState, FilterPill, IconButton } from '@/ui';
import { ImportModal } from '../import/ImportModal';
import {
  ALL,
  calendarSearch,
  dayPath,
  regionOptions,
  STATUS_OPTIONS,
  TYPE_OPTIONS,
} from './calendarSearch';
import { MonthGrid, SkeletonGrid, WeekdayHeader } from './MonthGrid';
import styles from './CalendarPage.module.css';
import tones from './tones.module.css';

/**
 * DS-01 «Календарь заявок» — главный экран диспетчера (FRONTEND_SPEC §8.2): месяц, фильтры в адресе,
 * опрос раз в 30 с, клик по дню — в DS-03. `modal=import` открывает DS-02.
 * «Все регионы» — запрос по каждому региону: итог дня — их сумма, в подсказке — строка на регион
 * (видно, в каком регионе неназначенные).
 */
export default function CalendarPage() {
  const [search, setSearch] = useSearchState(calendarSearch);
  const { user } = useAuth();
  const today = todayMsk();
  const currentMonth = monthOf(today);
  const poll = usePollInterval(POLL.calendar);
  const month = search.month ?? currentMonth;
  const { region, status, type } = search;

  const calendarOptions = (regionId: string) => ({
    queryKey: queryKeys.calendar(month, {
      region: regionId,
      status: status ?? undefined,
      type: type ?? undefined,
    }),
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      getCalendar(
        {
          ...calendarRange(month),
          region_id: regionId,
          status: status ?? undefined,
          type_bk: type ? BK[type] : undefined,
        },
        signal,
      ),
    refetchInterval: poll,
  });
  const allRegions = region === 'all';
  const calendar = useQuery({ ...calendarOptions(region), enabled: !allRegions });
  const { regions } = useRegions();
  const regionIds = regions.map((item) => item.id);
  const perRegion = useQueries({
    queries: regionIds.map((regionId) => ({ ...calendarOptions(regionId), enabled: allRegions })),
  });

  const perRegionData = perRegion.map((q) => q.data);
  // список участков с §14 растёт после ответа /regions: в зависимостях — отметки ответов, а не массив
  const perRegionStamp = `${regionIds.join(',')}|${perRegion.map((q) => q.dataUpdatedAt).join(',')}`;
  const model = useMemo(() => {
    const countByStatus = status !== null;
    if (allRegions) {
      if (!perRegionData.every(Boolean)) return null;
      return buildCalendarMonth(month, null, today, {
        countByStatus,
        regions: regionIds.map((regionId, index) => ({ regionId, response: perRegionData[index] })),
      });
    }
    return calendar.data ? buildCalendarMonth(month, calendar.data, today, { countByStatus }) : null;
    // perRegionData — новый массив на каждую отрисовку; ответы стабильны, сравниваем их отметки
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRegions, calendar.data, month, today, status, perRegionStamp]);

  const userRegions = user?.region_ids;
  const dayHref = useCallback(
    (date: string) => dayPath(date, region, userRegions),
    [region, userRegions],
  );

  const goToMonth = (next: string) => setSearch({ month: next === currentMonth ? null : next });
  const filtered = region !== 'all' || status !== null || type !== null;
  const failedRegion = perRegion.find((q) => q.isError && !q.data);
  const loadError = allRegions
    ? (failedRegion?.error ?? null)
    : calendar.isError && !calendar.data
      ? calendar.error
      : null;
  const retry = () => {
    if (allRegions) perRegion.forEach((q) => void q.refetch());
    else void calendar.refetch();
  };
  const retrying = allRegions ? perRegion.some((q) => q.isFetching) : calendar.isFetching;
  const gridDays = monthGrid(month).length;

  return (
    <div className={styles.page} style={{ '--weeks': gridDays / 7 } as CSSProperties}>
      <div className={styles.header}>
        <h1 className={styles.title}>Календарь заявок</h1>
        <div className={styles.monthNav}>
          <IconButton
            icon={ChevronLeft}
            label="Предыдущий месяц"
            variant="secondary"
            size="sm"
            onClick={() => goToMonth(addMonths(month, -1))}
          />
          <span className={styles.monthTitle}>{formatMonthTitle(month)}</span>
          <IconButton
            icon={ChevronRight}
            label="Следующий месяц"
            variant="secondary"
            size="sm"
            onClick={() => goToMonth(addMonths(month, 1))}
          />
        </div>
        <Button variant="secondary" size="sm" onClick={() => goToMonth(currentMonth)}>
          Сегодня
        </Button>
        <span className={styles.spacer} />
        {model && (
          <span className={styles.summary}>
            {calendarSummary(model.total, summaryRegionCount(region, regions))}
          </span>
        )}
      </div>

      <div className={styles.toolbar}>
        <FilterPill
          label="Регион"
          options={regionOptions(regions)}
          value={region}
          allValue="all"
          onChange={(value) => setSearch({ region: value })}
        />
        <FilterPill
          label="Статус"
          options={STATUS_OPTIONS}
          value={status ?? ALL}
          allValue={ALL}
          onChange={(value) => setSearch({ status: value === ALL ? null : value })}
        />
        <FilterPill
          label="Тип заявки"
          options={TYPE_OPTIONS}
          value={type ?? ALL}
          allValue={ALL}
          onChange={(value) => setSearch({ type: value === ALL ? null : value })}
        />
        <Button
          variant="ghost"
          size="sm"
          disabled={!filtered}
          onClick={() => setSearch({ region: 'all', status: null, type: null })}
        >
          Сбросить
        </Button>
        <span className={styles.spacer} />
        {model && model.legend.length > 0 && (
          <ul className={styles.legend} aria-label="Статусы в полосе">
            {model.legend.map((item) => (
              <li key={item.status} className={styles.legendItem}>
                <span className={cx(styles.swatch, tones[item.tone])} aria-hidden />
                {item.label}
              </li>
            ))}
          </ul>
        )}
      </div>

      <WeekdayHeader />
      <div className={styles.gridArea}>
        {model ? (
          <MonthGrid model={model} dayHref={dayHref} />
        ) : loadError ? (
          <div className={styles.errorPanel}>
            <ErrorState
              message={
                isApiError(loadError) && loadError.status !== 0 ? loadError.message : undefined
              }
              onRetry={retry}
              retrying={retrying}
            />
          </div>
        ) : (
          <SkeletonGrid cells={gridDays} />
        )}
      </div>

      {search.modal === 'import' && (
        <ImportModal
          initialDate={search.date}
          onClose={() => setSearch({ modal: null, date: null })}
        />
      )}
    </div>
  );
}

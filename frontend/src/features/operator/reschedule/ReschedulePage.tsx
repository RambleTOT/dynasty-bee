import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CalendarClock } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  bookingKey,
  findExact,
  isSlotFree,
  normalizeOutcome,
  normalizeSearch,
  slotsFromError,
  type BookingItem,
} from '@/adapters/booking';
import { rescheduleBooking, searchRequests, type SlotsQuery } from '@/api/booking';
import { isApiError } from '@/api/errors';
import { queryKeys } from '@/api/queryKeys';
import type { BookingRescheduleIn, BookingSlotsResponse } from '@/api/types';
import { dateShort, dateWithWeekday, typeFull, windowFull, windowShort } from '@/lib/booking';
import { notify } from '@/lib/notify';
import { knownRegionName } from '@/lib/regions';
import { addDays, todayMsk } from '@/lib/time';
import { PageLoader } from '@/pages/PageLoader';
import { Button, ErrorState, type InfoItem } from '@/ui';
import { BookingSummary } from '../booking/BookingSummary';
import type { SlotsStatus } from '../booking/SlotGrid';
import { SlotStep } from '../booking/SlotStep';
import { slotsKey, useSlots } from '../booking/useSlots';
import { hasErrorCode, invalidateBooking, mutationErrorText, refreshSearch } from '../bookingCache';
import { searchByIdUrl, searchUrl, type RescheduleState } from '../navigation';
import { T } from '../operatorTexts';
import styles from './ReschedulePage.module.css';

/** Дата по умолчанию — дата заявки, если она не раньше сегодня (хоть через месяц), иначе завтра. */
function defaultDate(requestDate: string, today: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(requestDate) && requestDate >= today
    ? requestDate
    : addDays(today, 1);
}

/**
 * O-02.1 «Перенос» (FRONTEND_SPEC §8.3.10): раскладка O-01.2 для существующей заявки. Заявка —
 * из поиска (state перехода); прямой заход — ищем по номеру в дне из адреса (`region`, `date`:
 * номера повторяются в разных днях), нет точного совпадения — в поиск.
 */
export default function ReschedulePage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const where = { regionId: params.get('region'), date: params.get('date') };
  const location = useLocation();
  const state = location.state as RescheduleState | null;
  const passed = findExact(state?.item ? [state.item] : undefined, id, where);

  const lookup = useQuery({
    queryKey: queryKeys.bookingSearch(id),
    queryFn: ({ signal }) => searchRequests(id, signal),
    enabled: !passed && id !== '',
    staleTime: 10_000,
    select: normalizeSearch,
  });
  const item = passed ?? findExact(lookup.data, id, where);

  if (item) return <RescheduleStep key={bookingKey(item)} item={item} q={state?.q} />;
  if (lookup.isError) {
    return (
      <div className={styles.center}>
        <ErrorState
          message={T.net.error}
          onRetry={() => void lookup.refetch()}
          retrying={lookup.isFetching}
        />
      </div>
    );
  }
  if (lookup.isSuccess || id === '') return <Navigate to={searchByIdUrl(id)} replace />;
  return <PageLoader />;
}

function RescheduleStep({ item, q }: { item: BookingItem; q?: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const today = todayMsk();
  const [date, setDate] = useState(() => defaultDate(item.date, today));
  const [selected, setSelected] = useState<string | null>(null);
  const [taken, setTaken] = useState(false);

  // окна — по полям заявки (⏳ 9.2: гигабит и транспорт, если бэк их отдаёт)
  const params = useMemo<SlotsQuery>(
    () => ({
      region_id: item.regionId,
      date,
      type_bk: item.typeBk,
      type_hd: item.typeHd,
      address: item.address || undefined,
      gigabit: item.gigabit ?? false,
      required_transport: item.requiredTransport ?? undefined,
    }),
    [item, date],
  );
  const slots = useSlots(params, { live: true });
  const model = slots.data;

  // выбранное окно стало занятым — выбор снимаем
  useEffect(() => {
    if (selected && model && !isSlotFree(model.slots, selected)) setSelected(null);
  }, [model, selected]);

  const back = searchUrl(item, q);

  const reschedule = useMutation({
    mutationFn: (body: BookingRescheduleIn) =>
      rescheduleBooking(item.id, body, { regionId: item.regionId, date: item.date }),
    onSuccess: (result, body) => {
      const outcome = normalizeOutcome(result);
      invalidateBooking(queryClient);
      // номер мог смениться (⏳ 9.4) — тогда в поиске ищем уже по новому номеру; день — новый
      const nextId = outcome.requestId ?? item.id;
      const moved = { id: nextId, regionId: item.regionId, date: outcome.date ?? body.new_date };
      navigate(searchUrl(moved, nextId === item.id ? q : undefined), { replace: true });
      notify(
        outcome.message ??
          T.resch.ok(
            item.id,
            dateShort(outcome.date ?? body.new_date),
            windowShort(outcome.window ?? body.new_window),
          ),
        'success',
      );
    },
    onError: (error) => {
      if (hasErrorCode(error, 'SLOT_TAKEN')) {
        setSelected(null);
        setTaken(true);
        const fresh = isApiError(error) ? slotsFromError(error.details) : null;
        if (fresh) {
          queryClient.setQueryData<BookingSlotsResponse>(slotsKey(params), (old) =>
            old ? { ...old, slots: fresh } : old,
          );
        } else {
          void slots.refetch();
        }
        return;
      }
      notify(mutationErrorText(error), 'error');
      // перенос недопустим (⏳ 9.9): статус мог измениться — обратно в поиск
      if (hasErrorCode(error, 'ILLEGAL_TRANSITION')) {
        refreshSearch(queryClient);
        navigate(back);
      }
    },
  });

  const type = typeFull(item.typeBk, item.typeHd);
  const region = knownRegionName(item.regionId);
  const rows: (InfoItem | false)[] = [
    region !== null && { label: T.card.region, value: region },
    {
      label: T.resch.current,
      value: `${dateWithWeekday(item.date)} · ${windowFull(item.window)}`,
    },
    Boolean(type) && { label: T.card.type, value: type },
    { label: T.card.address, value: item.address || T.card.noAddress },
    item.district !== undefined && { label: T.card.district, value: item.district },
  ];
  const status: SlotsStatus = model ? 'ready' : slots.isError ? 'error' : 'loading';

  return (
    <div className={styles.split}>
      <BookingSummary title={T.resch.title(item.id)} rows={rows} slots={model} />
      <SlotStep
        caption={T.resch.caption}
        note={T.resch.now(dateShort(item.date), windowShort(item.window))}
        today={today}
        date={date}
        onDateChange={(day) => {
          if (day === date) return;
          setDate(day);
          setSelected(null);
          setTaken(false);
        }}
        status={status}
        slots={model?.slots ?? []}
        selected={selected}
        onSelect={(slot) => {
          setSelected(slot);
          setTaken(false);
        }}
        onRetry={() => void slots.refetch()}
        retrying={slots.isFetching}
        taken={taken}
        actions={
          <>
            <Button
              variant="ghost"
              size="lg"
              icon={ArrowLeft}
              disabled={reschedule.isPending}
              onClick={() => navigate(back)}
            >
              {T.slots.back}
            </Button>
            <Button
              variant="primary"
              size="lg"
              icon={CalendarClock}
              disabled={!selected}
              loading={reschedule.isPending}
              onClick={() =>
                selected && reschedule.mutate({ new_date: date, new_window: selected })
              }
            >
              {selected ? T.resch.cta(windowFull(selected)) : T.slots.pick}
            </Button>
          </>
        }
      />
    </div>
  );
}

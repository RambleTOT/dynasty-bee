import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, CalendarCheck } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { normalizeOutcome, slotsFromError } from '@/adapters/booking';
import { createBooking, type SlotsQuery } from '@/api/booking';
import { isApiError } from '@/api/errors';
import type { BookingRequestIn, BookingSlotsResponse } from '@/api/types';
import { FEATURES } from '@/config';
import { searchParam, useSearchState } from '@/hooks/useSearchState';
import { phoneMasked, typeFull, windowFull } from '@/lib/booking';
import { dismissAll, notify } from '@/lib/notify';
import { TRANSPORT_LABEL } from '@/lib/statuses';
import { todayMsk } from '@/lib/time';
import { Button, Card, type InfoItem } from '@/ui';
import { hasErrorCode, invalidateBooking, mutationErrorText } from '../bookingCache';
import { searchUrl } from '../navigation';
import { T } from '../operatorTexts';
import { useDebouncedValue } from '../useDebouncedValue';
import { useOperatorRegion } from '../useOperatorRegion';
import { BookingSummary } from './BookingSummary';
import { bookedText, bookingRequestBody, TECHNOLOGY_REGION } from './bookingRequest';
import { EmergencyForm } from './EmergencyForm';
import { RegularForm } from './RegularForm';
import { RequestTabs } from './RequestTabs';
import type { SlotsStatus } from './SlotGrid';
import { SlotStep } from './SlotStep';
import {
  MIN_ADDRESS,
  stepOneReady,
  tomorrowMsk,
  useBookingForm,
  type BookingForm,
} from './useBookingForm';
import { slotsKey, useSlots } from './useSlots';
import styles from './NewRequestPage.module.css';

/** Вкладка — в адресе (`tab=regular|emergency`); «Авария» — только при ⏳ 9.1. */
const pageSearch = { tab: searchParam.enum(['regular', 'emergency'], 'regular') };

type SlotsFields = Pick<
  BookingForm,
  'date' | 'typeBk' | 'typeHd' | 'address' | 'gigabit' | 'transport'
>;

/**
 * Окна по полям формы: запрос уходит, когда выбраны регион, BK и HD (§8.3.7). У своего участка
 * (§14) подтипов нет — хватает BK.
 */
function slotsParams(
  region: string | null,
  fields: SlotsFields,
  withoutHd = false,
): SlotsQuery | null {
  if (!region || !fields.typeBk || (!fields.typeHd && !withoutHd)) return null;
  const address = fields.address.trim();
  return {
    region_id: region,
    date: fields.date,
    type_bk: fields.typeBk,
    type_hd: fields.typeHd || undefined,
    address: address.length >= MIN_ADDRESS ? address : undefined,
    gigabit: fields.gigabit,
    required_transport: fields.transport ?? undefined,
  };
}

/**
 * O-01 «Новая запись» → O-01.2 «Дата и окно» (FRONTEND_SPEC §8.3.7, §8.3.8); вкладка «Авария» —
 * §8.3.9, только при флаге `emergencyByRegion`.
 */
export default function NewRequestPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchState(pageSearch);
  const emergency = FEATURES.emergencyByRegion && search.tab === 'emergency';
  const regions = useOperatorRegion();
  const { region } = regions;
  const regionTypes = regions.regions.find((item) => item.id === region)?.types ?? null;
  const [form, dispatch] = useBookingForm();

  // тост с номером записи висит, пока его не закроют, — но не дольше, чем открыта страница
  useEffect(() => dismissAll, []);

  const today = todayMsk();

  // Шаг 1 — фоном, после паузы 300 мс и без опроса; шаг 2 — сразу, с опросом (useSlots)
  const { date, typeBk, typeHd, address, gigabit, transport } = form;
  const params = useMemo(
    () =>
      slotsParams(
        region,
        { date, typeBk, typeHd, address, gigabit, transport },
        regionTypes !== null,
      ),
    [region, date, typeBk, typeHd, address, gigabit, transport, regionTypes],
  );
  const typing = useDebouncedValue(params, 300);
  const onStepTwo = !emergency && form.step === 2;
  // на вкладке «Авария» окна не нужны
  const activeParams = emergency ? null : onStepTwo ? params : typing;
  const slots = useSlots(activeParams, { live: onStepTwo });
  const model = slots.data;

  // выбранное окно стало занятым — выбор снимаем (свежие окна шага 2, не прошлый ответ)
  useEffect(() => {
    if (onStepTwo && model && !slots.isPlaceholderData) {
      dispatch({ type: 'slots', slots: model.slots });
    }
  }, [onStepTwo, model, slots.isPlaceholderData, dispatch]);

  const create = useMutation({
    mutationFn: (body: BookingRequestIn) => createBooking(body),
    onSuccess: (result, body) => {
      const outcome = normalizeOutcome(result);
      const id = outcome.requestId;
      const ref = id ? { id, regionId: body.region_id, date: outcome.date ?? body.date } : null;
      // окно было «свободно», а бригаду не поставили (BACKEND_REQUESTS п. 50) — предупреждение
      const unassigned = outcome.status === 'unassigned';
      notify(bookedText(outcome, body), unassigned ? 'warning' : 'success', {
        persistent: true,
        description: unassigned ? T.book.unassignedHint : undefined,
        action: ref
          ? { label: T.book.open, onClick: () => navigate(searchUrl(ref, ref.id)) }
          : undefined,
      });
      // записали — сразу новая запись: пустой шаг 1, регион остаётся (useOperatorRegion)
      dispatch({ type: 'reset', date: tomorrowMsk() });
      invalidateBooking(queryClient);
    },
    onError: (error) => {
      if (hasErrorCode(error, 'SLOT_TAKEN')) {
        // тоста нет: плашка над кнопками, выбор снят, окна — из ответа (⏳ 9.5) или заново
        dispatch({ type: 'slotTaken' });
        const fresh = isApiError(error) ? slotsFromError(error.details) : null;
        if (fresh && activeParams) {
          queryClient.setQueryData<BookingSlotsResponse>(slotsKey(activeParams), (old) =>
            old ? { ...old, slots: fresh } : old,
          );
        } else {
          void slots.refetch();
        }
        return;
      }
      notify(mutationErrorText(error), 'error');
    },
  });

  function book() {
    if (!region || !form.window || create.isPending) return;
    create.mutate(bookingRequestBody({ ...form, window: form.window }, region, model?.district));
  }

  if (onStepTwo) {
    const district = model?.district;
    const summary: (InfoItem | false)[] = [
      { label: T.new.region, value: regions.nameOf(region) },
      {
        label: T.new.address,
        value: [form.address.trim(), district].filter(Boolean).join(' · '),
      },
      { label: T.new.typeSummary, value: typeFull(form.typeBk, form.typeHd) },
      region === TECHNOLOGY_REGION
        ? { label: T.new.technology, value: T.new.technologyValue(form.technology, form.gigabit) }
        : { label: T.new.gigabit, value: form.gigabit ? T.card.yes : T.card.no },
      Boolean(form.contact) && { label: T.new.contactShort, value: phoneMasked(form.contact) },
      {
        label: T.new.transport,
        value: form.transport ? TRANSPORT_LABEL[form.transport] : T.new.transportNone,
      },
    ];
    const status: SlotsStatus = model ? 'ready' : slots.isError ? 'error' : 'loading';
    const cta = form.window ? T.book.cta(windowFull(form.window)) : T.slots.pick;

    return (
      <div className={styles.split}>
        <BookingSummary
          title={T.new.title}
          rows={summary}
          slots={model}
          onEdit={() => dispatch({ type: 'step', value: 1 })}
        />
        <SlotStep
          caption={T.new.step2}
          today={today}
          date={form.date}
          onDateChange={(day) => dispatch({ type: 'date', value: day })}
          status={status}
          slots={model?.slots ?? []}
          selected={form.window}
          onSelect={(slot) => dispatch({ type: 'window', value: slot })}
          onRetry={() => void slots.refetch()}
          retrying={slots.isFetching}
          taken={form.slotTaken}
          actions={
            <>
              <Button
                variant="ghost"
                size="lg"
                icon={ArrowLeft}
                disabled={create.isPending}
                onClick={() => dispatch({ type: 'step', value: 1 })}
              >
                {T.slots.back}
              </Button>
              <Button
                variant="primary"
                size="lg"
                icon={CalendarCheck}
                disabled={!form.window}
                loading={create.isPending}
                onClick={book}
              >
                {cta}
              </Button>
            </>
          }
        />
      </div>
    );
  }

  return (
    <div className={styles.center}>
      <Card className={styles.card}>
        <div className={styles.head}>
          <h2 className={styles.title}>{T.new.title}</h2>
          {!emergency && <span className={styles.step}>{T.new.step1}</span>}
        </div>
        {FEATURES.emergencyByRegion && (
          <RequestTabs
            value={emergency ? 'emergency' : 'regular'}
            onChange={(tab) => setSearch({ tab })}
          />
        )}
        {emergency ? (
          <EmergencyForm regions={regions} />
        ) : (
          <>
            <RegularForm form={form} dispatch={dispatch} regions={regions} slots={model} />
            <div className={styles.footer}>
              <Button
                variant="primary"
                size="lg"
                icon={ArrowRight}
                disabled={!stepOneReady(form, region, regionTypes)}
                onClick={() => dispatch({ type: 'step', value: 2 })}
              >
                {T.new.next}
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

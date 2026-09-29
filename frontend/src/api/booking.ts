/**
 * Ручки оператора (FRONTEND_SPEC §8.3.4). Оператору открыты только /regions, /booking/*
 * и /events/apply для urgent_order_added; /days, /planning, /data, /calendar не вызываем.
 */
import { api } from './client';
import type {
  BookingCancelBody,
  BookingMutationResult,
  BookingRequestIn,
  BookingRequestOut,
  BookingSearchItem,
  BookingSlotsResponse,
  ReplanResult,
  UrgentRequestIn,
} from './types';

type Signal = AbortSignal | undefined;

/** Поиск по № или адресу — по всем регионам пользователя, до 20 результатов. */
export const searchRequests = (q: string, signal?: Signal) =>
  api.get<BookingSearchItem[]>('/booking/requests', { query: { q }, signal });

export interface SlotsQuery {
  region_id: string;
  date: string;
  type_bk: string;
  type_hd?: string | null;
  address?: string | null;
  gigabit?: boolean;
  required_transport?: string | null;
}

export const getSlots = (query: SlotsQuery, signal?: Signal) =>
  api.get<BookingSlotsResponse>('/booking/slots', { query: { ...query }, signal });

export const createBooking = (body: BookingRequestIn) =>
  api.post<BookingRequestOut & BookingMutationResult>('/booking/requests', body);

/**
 * День заявки из строки поиска. Номера в разных днях и регионах совпадают (демо-наборы), а бэк ищет
 * заявку по номеру в самом новом дне — `region_id` и `date` уточняют, какую именно (BACKEND_REQUESTS
 * п. 28). Бэк без правки лишние параметры запроса пропускает.
 */
export interface BookingDay {
  regionId?: string;
  date?: string;
}

const dayQuery = (day?: BookingDay) => ({
  query: { region_id: day?.regionId || undefined, date: day?.date || undefined },
});

export const cancelBooking = (requestId: string, body: BookingCancelBody, day?: BookingDay) =>
  api.post<BookingMutationResult>(
    `/booking/requests/${encodeURIComponent(requestId)}/cancel`,
    body,
    dayQuery(day),
  );

export const rescheduleBooking = (
  requestId: string,
  body: { new_date: string; new_window: string },
  day?: BookingDay,
) =>
  api.post<BookingMutationResult>(
    `/booking/requests/${encodeURIComponent(requestId)}/reschedule`,
    body,
    dayQuery(day),
  );

/**
 * Авария от оператора (⏳ 9.1): без plan_id и event_time — план и часы дня бэк берёт сам
 * по params.region_id. window_* обязательны по схеме, бэк их переопределяет.
 */
export function applyOperatorEmergency(input: {
  regionId: string;
  comment?: string;
  request: UrgentRequestIn;
}) {
  return api.post<ReplanResult>('/events/apply', {
    type: 'urgent_order_added',
    source: 'operator',
    apply: false,
    params: { region_id: input.regionId, comment: input.comment || undefined },
    request: input.request,
  });
}

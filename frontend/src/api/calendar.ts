/** DS-01: календарь заявок по дням (FRONTEND_SPEC §5.3). */
import { api } from './client';
import type { CalendarResponse } from './types';

type Signal = AbortSignal | undefined;

export interface CalendarQuery {
  from: string;
  to: string;
  region_id?: string;
  status?: string;
  type_bk?: string;
}

export const getCalendar = (query: CalendarQuery, signal?: Signal) =>
  api.get<CalendarResponse>('/calendar', { query: { ...query }, signal });

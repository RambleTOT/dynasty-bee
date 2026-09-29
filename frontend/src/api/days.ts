/** DS-03: состояние дня по регионам — план, версия, предложения, часы (FRONTEND_SPEC §5.3). */
import { api } from './client';
import type { DayResponse } from './types';

type Signal = AbortSignal | undefined;

export const getDay = (date: string, regionId: string, signal?: Signal) =>
  api.get<DayResponse>(`/days/${date}`, { query: { region_id: regionId }, signal });

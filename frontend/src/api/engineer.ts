/** Ручки инженера (FRONTEND_SPEC §9): свой день, маршрут, действия. Инженер — по токену. */
import { api } from './client';
import type { EngineerActionIn, EngineerActionOut, EngineerMeDay, EngineerRoute } from './types';

type Signal = AbortSignal | undefined;

export const getMyDay = (signal?: Signal) =>
  api.get<EngineerMeDay>('/engineers/me/day', { signal });

export const getMyRoute = (signal?: Signal) =>
  api.get<EngineerRoute>('/engineers/me/route', { query: { remaining: true }, signal });

/** Действие инженера. `at` не шлём — время берёт бэк по часам дня (§7). */
export const postAction = (body: EngineerActionIn) =>
  api.post<EngineerActionOut & { day?: EngineerMeDay | null }>('/engineers/me/actions', body);

/** Часы дня (⏳ §1, флаг FEATURES.dayClock): только чтение — переводит бэк (D-28). */
import { api } from './client';
import type { ClockOut } from './types';

type Signal = AbortSignal | undefined;

export const getClock = (scenarioId: string, signal?: Signal) =>
  api.get<ClockOut>(`/data/scenarios/${scenarioId}/clock`, { signal });

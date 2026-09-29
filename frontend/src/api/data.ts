/** Данные дня: регионы, импорт CSV, сценарий, ростер (FRONTEND_SPEC §5.3). */
import { api } from './client';
import type {
  EngineerCreate,
  EngineerOut,
  EngineerPatch,
  RegionInfo,
  ScenarioOut,
  ScenarioSummary,
} from './types';

type Signal = AbortSignal | undefined;

export const getRegions = (signal?: Signal) => api.get<RegionInfo[]>('/regions', { signal });

export interface ImportFiles {
  requestsFile: File;
  controlFile?: File | null;
  /** Ростер (`engineers_file`, формат бэка — adapters/regionRoster.ts), только для своего участка. */
  engineersFile?: File | null;
  regionId: string;
  date: string;
}

export function importBeeline({
  requestsFile,
  controlFile,
  engineersFile,
  regionId,
  date,
}: ImportFiles) {
  const form = new FormData();
  form.append('requests_file', requestsFile);
  if (controlFile) form.append('control_file', controlFile);
  if (engineersFile) form.append('engineers_file', engineersFile);
  form.append('region_id', regionId);
  form.append('date', date);
  return api.postForm<ScenarioSummary>('/data/import-beeline', form);
}

export const getScenario = (scenarioId: string, signal?: Signal) =>
  api.get<ScenarioOut>(`/data/scenarios/${scenarioId}`, { signal });

export const getScenarioEngineers = (scenarioId: string, signal?: Signal) =>
  api.get<EngineerOut[]>(`/data/scenarios/${scenarioId}/engineers`, { signal });

/** Бэк принимает массив бригад. */
export const addEngineers = (scenarioId: string, engineers: EngineerCreate[]) =>
  api.post<ScenarioSummary>(`/data/scenarios/${scenarioId}/engineers`, engineers);

export const patchEngineer = (scenarioId: string, engineerId: string, patch: EngineerPatch) =>
  api.patch<ScenarioSummary>(
    `/data/scenarios/${scenarioId}/engineers/${encodeURIComponent(engineerId)}`,
    patch,
  );

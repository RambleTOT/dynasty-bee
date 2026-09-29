/**
 * Свои участки (§14, `anyRegionEnabled`; ТЗ бэка — docs/spec/BACKEND_ANY_REGION.md): создать,
 * поменять название, офис и нормативы, прочитать и сохранить ростер. Список — `GET /regions` (data.ts).
 */
import { api } from './client';
import type { RegionCreate, RegionInfo, RegionPatch, RosterEngineer } from './types';

const path = (regionId: string) => `/regions/${encodeURIComponent(regionId)}`;

export const createRegion = (body: RegionCreate) => api.post<RegionInfo>('/regions', body);

export const patchRegion = (regionId: string, body: RegionPatch) =>
  api.patch<RegionInfo>(path(regionId), body);

export const getRegionRoster = (regionId: string, signal?: AbortSignal) =>
  api.get<RosterEngineer[]>(`${path(regionId)}/roster`, { signal });

export const putRegionRoster = (regionId: string, roster: RosterEngineer[]) =>
  api.put<RosterEngineer[]>(`${path(regionId)}/roster`, roster);

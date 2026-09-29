import { queryOptions, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { getRegions } from '@/api/data';
import { queryKeys } from '@/api/queryKeys';
import type { RegionInfo } from '@/api/types';
import { anyRegionEnabled, isBuiltinRegion, rememberRegions } from '@/lib/regions';
import { REGION_LABEL, REGIONS } from '@/lib/statuses';

/**
 * `GET /regions`: названия и офисы участков, «N бригад» в карточках импорта, число участков в итоге
 * календаря. Справочник меняется редко — не чаще раза в 5 минут; после создания участка (§14) его
 * инвалидирует импорт.
 */
export const regionsQuery = queryOptions({
  queryKey: queryKeys.regions,
  queryFn: async ({ signal }) => {
    const regions = await getRegions(signal);
    rememberRegions(regions);
    return regions;
  },
  staleTime: 5 * 60_000,
});

export interface RegionItem {
  id: string;
  name: string;
  /** Участок кейса: его бригады и нормативы заданы кейсом. */
  builtin: boolean;
  info: RegionInfo | null;
}

/**
 * Участки для списков и фильтров: три участка кейса в порядке кейса; со своими участками (§14,
 * `anyRegionEnabled`) — после них свои участки из `GET /regions` в порядке ответа.
 */
export function regionItems(
  data: readonly RegionInfo[] | undefined,
  anyRegion: boolean = anyRegionEnabled(),
): RegionItem[] {
  const byId = new Map((data ?? []).map((region) => [region.region_id, region]));
  const builtin = REGIONS.map((id) => ({
    id,
    name: byId.get(id)?.name || REGION_LABEL[id],
    builtin: true,
    info: byId.get(id) ?? null,
  }));
  if (!anyRegion) return builtin;
  const custom = (data ?? [])
    .filter((region) => !isBuiltinRegion(region.region_id))
    .map((region) => ({
      id: region.region_id,
      name: region.name || region.region_id,
      builtin: false,
      info: region,
    }));
  return [...builtin, ...custom];
}

export function useRegions() {
  const query = useQuery(regionsQuery);
  const regions = useMemo(() => regionItems(query.data), [query.data]);
  return { regions, query };
}

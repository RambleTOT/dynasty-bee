import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { useAuth } from '@/auth/useAuth';
import { regionsQuery as regionsQueryOptions } from '@/hooks/useRegions';
import { regionLabel } from '@/lib/dictionaries';
import { anyRegionEnabled, isBuiltinRegion } from '@/lib/regions';
import { REGIONS } from '@/lib/statuses';

/** Последний выбранный регион — на время сессии вкладки (FRONTEND_SPEC §8.3.5). */
export const REGION_STORAGE_KEY = 'operator_region';

export interface OperatorRegion {
  id: string;
  name: string;
  /** Свой участок (§14): типы заявок из его нормативов; `null` — типы из нормативов оператора связи. */
  types: readonly string[] | null;
}

function readStored(): string | null {
  try {
    return window.sessionStorage.getItem(REGION_STORAGE_KEY);
  } catch {
    return null; // хранилище недоступно (приватный режим) — берём первый регион
  }
}

function writeStored(id: string) {
  try {
    window.sessionStorage.setItem(REGION_STORAGE_KEY, id);
  } catch {
    // не запомнили — не страшно
  }
}

/** Порядок сегментов: Восток · Юго-восток · Югоцентр, незнакомые — в конце. */
const order = (id: string) => {
  const index = (REGIONS as readonly string[]).indexOf(id);
  return index === -1 ? REGIONS.length : index;
};

/**
 * Регионы оператора: только из `user.region_ids`, названия — из GET /regions (пока ответа нет —
 * по словарю). Свои участки (§14) открыты всем операторам: в токене их нет. По умолчанию — последний
 * выбранный, иначе первый.
 */
export function useOperatorRegion() {
  const { user } = useAuth();
  const regionsQuery = useQuery(regionsQueryOptions);

  const allowed = user?.region_ids;
  const regions = useMemo<OperatorRegion[]>(() => {
    const fromApi = regionsQuery.data ?? [];
    const names = new Map(fromApi.map((region) => [region.region_id, region.name]));
    const types = new Map(
      fromApi.map((region) => [
        region.region_id,
        anyRegionEnabled() && !isBuiltinRegion(region.region_id) && region.norms?.types.length
          ? // аварии — вкладкой «Авария», как у участков кейса
            region.norms.types
              .filter((type) => type.skill !== 'emergency')
              .map((type) => type.type_bk)
          : null,
      ]),
    );
    // region_ids не пришли — все регионы из справочника (как подпись в AppBar) [Д]
    const ids = allowed?.length ? allowed : fromApi.map((region) => region.region_id);
    const custom = anyRegionEnabled()
      ? fromApi.map((region) => region.region_id).filter((id) => !isBuiltinRegion(id))
      : [];
    return [...new Set([...ids, ...custom])]
      .sort((a, b) => order(a) - order(b))
      .map((id) => ({ id, name: names.get(id) || regionLabel(id), types: types.get(id) ?? null }));
  }, [allowed, regionsQuery.data]);

  const [stored, setStored] = useState(readStored);
  const region = regions.find((item) => item.id === stored)?.id ?? regions[0]?.id ?? null;

  const setRegion = useCallback((id: string) => {
    setStored(id);
    writeStored(id);
  }, []);

  const nameOf = useCallback(
    (id: string | null) =>
      id ? (regions.find((item) => item.id === id)?.name ?? regionLabel(id)) : '',
    [regions],
  );

  return {
    regions,
    region,
    setRegion,
    nameOf,
    /** Регионов ещё нет: ждём GET /regions. */
    loading: regions.length === 0 && regionsQuery.isPending,
    failed: regions.length === 0 && regionsQuery.isError,
    retry: regionsQuery.refetch,
  };
}

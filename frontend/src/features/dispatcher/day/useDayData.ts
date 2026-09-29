/**
 * Данные экрана дня: `/days` → цепочка версий (события + планы) → действующий план → его сценарий →
 * DayModel (FRONTEND_SPEC §5.3, §6.1). Опрос — POLL.day, при открытом сокете живых обновлений — редкий.
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';
import { getScenario } from '@/api/data';
import { getDay } from '@/api/days';
import { listEvents } from '@/api/events';
import { getPlan, listPlans } from '@/api/planning';
import { queryKeys } from '@/api/queryKeys';
import { getGeojson } from '@/api/visualization';
import { resolveDayChain } from '@/adapters/dayChain';
import { buildDayModel } from '@/adapters/dayModel';
import { POLL } from '@/config';
import { usePollInterval } from '@/realtime/useRealtime';

export function dayChainKey(date: string, regionId: string) {
  return [...queryKeys.days(date, regionId), 'chain'] as const;
}

export function useDayData(date: string, regionId: string, clockOverride: string | null) {
  const poll = usePollInterval(POLL.day);
  const dayQuery = useQuery({
    queryKey: queryKeys.days(date, regionId),
    queryFn: ({ signal }) => getDay(date, regionId, signal),
    refetchInterval: poll,
  });
  const region = dayQuery.data?.regions.find((r) => String(r.region_id) === regionId) ?? null;
  const hasPlan = Boolean(region?.active_plan_id || region?.draft_plan_id);

  const chainQuery = useQuery({
    queryKey: dayChainKey(date, regionId),
    queryFn: async ({ signal }) => {
      const [events, plans] = await Promise.all([listEvents({ limit: 200 }, signal), listPlans(null, signal, 200)]);
      return { events, plans: plans.items };
    },
    enabled: hasPlan,
    refetchInterval: poll,
  });
  // пока цепочка грузится, план не запрашиваем — иначе мелькнёт прежняя версия
  const chainReady = !hasPlan || chainQuery.isSuccess || chainQuery.isError;

  const chain = useMemo(
    () =>
      region
        ? resolveDayChain(region, chainQuery.data?.events ?? [], chainQuery.data?.plans ?? [])
        : null,
    [region, chainQuery.data],
  );
  const headPlanId = chainReady ? (chain?.headPlanId ?? null) : null;

  // Новая версия (после «Принять», события, переназначения): пока грузится её план и сценарий,
  // показываем прежние того же дня — иначе экран дня и открытые окна пропадают и появляются снова.
  const dayKey = `${date}:${regionId}`;
  const shownFor = useRef<string | null>(null);
  const keepSameDay = <T,>(previous: T | undefined) => (shownFor.current === dayKey ? previous : undefined);

  const planQuery = useQuery({
    queryKey: queryKeys.plan(headPlanId ?? '-'),
    queryFn: ({ signal }) => getPlan(headPlanId as string, signal),
    enabled: Boolean(headPlanId),
    refetchInterval: poll,
    placeholderData: keepSameDay,
  });

  // сценарий действующей версии: после событий — производный (в нём новые заявки)
  const scenarioId = headPlanId ? (planQuery.data?.scenario_id ?? null) : (region?.scenario_id ?? null);
  const scenarioQuery = useQuery({
    queryKey: queryKeys.scenario(scenarioId ?? '-'),
    queryFn: ({ signal }) => getScenario(scenarioId as string, signal),
    enabled: Boolean(scenarioId),
    refetchInterval: poll,
    placeholderData: keepSameDay,
  });

  const geojsonQuery = useQuery({
    queryKey: queryKeys.geojson(headPlanId ?? '-'),
    queryFn: ({ signal }) => getGeojson(headPlanId as string, signal),
    enabled: Boolean(headPlanId) && region?.plan_state !== 'none',
    staleTime: Infinity,
    retry: false,
  });

  const plan = headPlanId ? (planQuery.data ?? null) : null;
  const model = useMemo(() => {
    // пока цепочка не пришла, план дня неизвестен: модель «без плана» запустила бы лишнее сравнение
    if (!region || !scenarioQuery.data || !chainReady) return null;
    if (headPlanId && !plan) return null;
    return buildDayModel({
      date,
      region,
      scenario: scenarioQuery.data,
      plan,
      chain,
      clockOverride,
    });
  }, [date, region, scenarioQuery.data, plan, headPlanId, chain, chainReady, clockOverride]);
  useEffect(() => {
    if (model) shownFor.current = dayKey;
  }, [model, dayKey]);

  const loading =
    dayQuery.isPending ||
    (Boolean(region) &&
      (!chainReady || (Boolean(headPlanId) && planQuery.isPending) || (Boolean(scenarioId) && scenarioQuery.isPending)));
  const error = dayQuery.error ?? planQuery.error ?? scenarioQuery.error ?? null;

  const refetch = () => {
    void dayQuery.refetch();
    if (hasPlan) void chainQuery.refetch();
    if (headPlanId) void planQuery.refetch();
    if (scenarioId) void scenarioQuery.refetch();
  };

  return {
    day: dayQuery.data ?? null,
    region,
    chain,
    plan,
    scenario: scenarioQuery.data ?? null,
    geojson: geojsonQuery.data ?? null,
    model,
    loading,
    /** Регион без сценария на эту дату (день пустой). */
    empty: dayQuery.isSuccess && !region,
    error: model ? null : error,
    refetch,
    fetching: dayQuery.isFetching,
  };
}

export type DayData = ReturnType<typeof useDayData>;

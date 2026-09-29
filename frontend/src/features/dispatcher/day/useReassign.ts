/**
 * Данные DS-08 (FRONTEND_SPEC §6.7): базовый план — действующий или предложенный (DS-07 «Править вручную»),
 * кандидаты и проверки `reassign/check`: до 5 ближайших — сразу и параллельно, выбранная бригада и позиция —
 * отдельным запросом. Проверка ничего не меняет на бэке; кэш — на план, заявку, бригаду и позицию.
 */
import { useQueries, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { getScenario } from '@/api/data';
import { checkReassign, getPlan } from '@/api/planning';
import { queryKeys } from '@/api/queryKeys';
import type { DayRegion, ReassignCheckResponse } from '@/api/types';
import { buildDayModel, type DayModel, type DayRequest } from '@/adapters/dayModel';
import { reassignCandidates, summarizeCheck, type CheckSummary } from '@/adapters/reassign';

/** Регион дня для модели базового плана: те же офис, часы и источник, что у действующей версии. */
function regionOf(model: DayModel): DayRegion {
  return {
    region_id: model.regionId,
    source: model.source,
    office: model.office
      ? {
          address: model.office.address ?? '',
          lat: model.office.point[0],
          lon: model.office.point[1],
        }
      : null,
    plan_state: model.planState,
    version: model.version,
    clock: model.clock,
  };
}

/**
 * Модель дня по базовому плану. Совпадает с действующим — это модель дня; иначе — план и его сценарий
 * (в предложении могут быть новые заявки, например срочная).
 */
export function useReassignBase(model: DayModel, basePlanId: string | null) {
  const external = Boolean(basePlanId) && basePlanId !== model.planId;
  const planQuery = useQuery({
    queryKey: queryKeys.plan(basePlanId ?? '-'),
    queryFn: ({ signal }) => getPlan(basePlanId as string, signal),
    enabled: external,
  });
  const scenarioId = planQuery.data?.scenario_id ?? null;
  const scenarioQuery = useQuery({
    queryKey: queryKeys.scenario(scenarioId ?? '-'),
    queryFn: ({ signal }) => getScenario(scenarioId as string, signal),
    enabled: external && Boolean(scenarioId),
  });

  const base = useMemo(() => {
    if (!external) return model;
    if (!planQuery.data || !scenarioQuery.data) return null;
    return buildDayModel({
      date: model.date,
      region: regionOf(model),
      scenario: scenarioQuery.data,
      plan: planQuery.data,
    });
  }, [external, model, planQuery.data, scenarioQuery.data]);

  return {
    base,
    planId: external ? basePlanId : model.planId,
    loading: external && !base && !planQuery.isError && !scenarioQuery.isError,
    failed: external && (planQuery.isError || scenarioQuery.isError),
    retry: () => {
      void planQuery.refetch();
      if (scenarioId) void scenarioQuery.refetch();
    },
  };
}

export interface CheckState {
  summary: CheckSummary | null;
  loading: boolean;
  failed: boolean;
  error: unknown;
  refetch: () => void;
}

function checkOptions(
  planId: string | null,
  orderId: string,
  engineerId: string,
  position: number | null,
  time: string | null,
) {
  return {
    queryKey: queryKeys.reassignCheck(planId ?? '-', orderId, engineerId, position, time),
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      checkReassign(
        planId as string,
        {
          order_id: orderId,
          to_engineer_id: engineerId,
          ...(position != null ? { position } : {}),
          ...(time ? { time } : {}),
        },
        signal,
      ),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  };
}

interface CheckQuery {
  data?: ReassignCheckResponse;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
}

function toState(query: CheckQuery, request: DayRequest | null): CheckState {
  return {
    summary: query.data && request ? summarizeCheck(query.data, request) : null,
    loading: query.isFetching && !query.data,
    failed: query.isError,
    error: query.error,
    refetch: () => void query.refetch(),
  };
}

/** Кандидаты и параллельная проверка ближайших (`position: null` — позицию выбирает бэк). */
export function useReassignCandidates(
  base: DayModel | null,
  planId: string | null,
  requestId: string,
  /** «Сейчас» дня для проверки (флаг `reassignTime`); `null` — не передаём. */
  time: string | null = null,
) {
  const request = base?.requestById.get(requestId) ?? null;
  const candidates = useMemo(
    () => (base && request ? reassignCandidates(base, request) : []),
    [base, request],
  );
  const nearest = candidates.filter((c) => c.checkNow);
  const parallel = useQueries({
    queries: nearest.map((c) => ({
      ...checkOptions(planId, requestId, c.engineer.id, null, time),
      enabled: Boolean(planId),
    })),
  });
  const checks = new Map<string, CheckState>();
  nearest.forEach((c, index) => checks.set(c.engineer.id, toState(parallel[index], request)));
  return { request, candidates, checks };
}

/**
 * Проверка выбранной бригады с явной позицией (`null` — «лучшая»). У ближайших с `null` запрос общий
 * с параллельной проверкой — повторно не уходит.
 */
export function useSelectedCheck(
  planId: string | null,
  requestId: string,
  request: DayRequest | null,
  selected: { engineerId: string; position: number | null } | null,
  time: string | null = null,
): CheckState | null {
  const query = useQuery({
    ...checkOptions(planId, requestId, selected?.engineerId ?? '-', selected?.position ?? null, time),
    enabled: Boolean(planId && selected),
  });
  return selected ? toState(query, request) : null;
}

/**
 * Черновик на таймлайне (§8.2 пп. 22–23): модель дня по версии-черновику — предложению или, при
 * сравнении версий, текущей — и что в ней изменилось против базы. Ручное переназначение готовит
 * черновик само (adapters/timelineDraft.ts → reassignDraft): версии у него ещё нет.
 */
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { getScenario } from '@/api/data';
import { getPlan } from '@/api/planning';
import { queryKeys } from '@/api/queryKeys';
import type { DayRegion, ScenarioOut } from '@/api/types';
import { buildDayModel, type DayModel } from '@/adapters/dayModel';
import { planOverlay, type TimelineOverlay } from '@/adapters/timelineDraft';

export type DraftRequest =
  | {
      kind: 'plan';
      /** Что рисуем: предложение или (при сравнении версий) текущая версия. */
      planId: string;
      /** С чем сравниваем: версия, от которой считалось предложение, или выбранная прежняя. */
      basePlanId: string;
      /** «К предложению» на панели черновика. */
      proposalId: string | null;
      caption: string;
    }
  | {
      kind: 'reassign';
      model: DayModel;
      overlay: TimelineOverlay;
      caption: string;
    };

export interface DraftTimeline {
  model: DayModel;
  overlay: TimelineOverlay;
}

export function useDraftTimeline(
  request: DraftRequest | null,
  day: {
    date: string;
    region: DayRegion | null;
    scenario: ScenarioOut | null;
    model: DayModel | null;
    clock: string | null;
  },
): { draft: DraftTimeline | null; loading: boolean; failed: boolean } {
  const planRequest = request?.kind === 'plan' ? request : null;
  const headId = day.model?.planId ?? null;
  const planId = planRequest?.planId ?? null;
  const baseId = planRequest?.basePlanId ?? null;

  const planQuery = useQuery({
    queryKey: queryKeys.plan(planId ?? '-'),
    queryFn: ({ signal }) => getPlan(planId as string, signal),
    enabled: Boolean(planId) && planId !== headId,
    staleTime: 60_000,
  });
  const plan = planId && planId === headId ? (day.model?.plan ?? null) : (planQuery.data ?? null);

  const scenarioId = plan?.scenario_id ?? null;
  const sameScenario = Boolean(scenarioId) && scenarioId === day.scenario?.scenario_id;
  const scenarioQuery = useQuery({
    queryKey: queryKeys.scenario(scenarioId ?? '-'),
    queryFn: ({ signal }) => getScenario(scenarioId as string, signal),
    enabled: Boolean(planRequest && scenarioId) && !sameScenario,
    staleTime: 60_000,
  });
  const scenario = sameScenario ? day.scenario : (scenarioQuery.data ?? null);

  const baseQuery = useQuery({
    queryKey: queryKeys.plan(baseId ?? '-'),
    queryFn: ({ signal }) => getPlan(baseId as string, signal),
    enabled: Boolean(baseId) && baseId !== headId,
    staleTime: 60_000,
  });
  const base = baseId && baseId === headId ? (day.model?.plan ?? null) : (baseQuery.data ?? null);

  const { date, region, model, clock } = day;
  const built = useMemo<DraftTimeline | null>(() => {
    if (!planRequest || !plan || !base || !scenario || !region || !model) return null;
    const draftModel =
      plan.plan_id === model.planId
        ? model
        : buildDayModel({ date, region, scenario, plan, clockOverride: clock });
    const labelOf = (id: string) =>
      draftModel.requestById.get(id)?.shortId ?? model.requestById.get(id)?.shortId ?? id;
    return { model: draftModel, overlay: planOverlay(plan, base, labelOf) };
  }, [planRequest, plan, base, scenario, region, model, date, clock]);

  if (request?.kind === 'reassign') {
    return { draft: { model: request.model, overlay: request.overlay }, loading: false, failed: false };
  }
  const failed = planQuery.isError || scenarioQuery.isError || baseQuery.isError;
  return { draft: built, loading: Boolean(planRequest) && !built && !failed, failed };
}

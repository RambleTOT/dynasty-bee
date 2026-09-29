/**
 * «Пересчитать» устаревшее предложение (BACKEND_REQUESTS п. 48): то же событие — на действующей
 * версии, результат — новое предложение. Тело события — отправленное из этой вкладки, иначе
 * собираем из журнала и сценария предложения (adapters/resend.ts).
 */
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { getScenario } from '@/api/data';
import { ApiError } from '@/api/errors';
import type { DispatcherEvent } from '@/api/events';
import { getPlan } from '@/api/planning';
import { queryKeys } from '@/api/queryKeys';
import type { RequestOut } from '@/api/types';
import type { DayChain } from '@/adapters/dayChain';
import { canRebuild, needsScenarioRequest, rebuildEvent, requestIdOf } from '@/adapters/resend';
import type { DayActions } from './useDayActions';

export interface Resend {
  /** Это предложение можно пересчитать. */
  can: (planId: string) => boolean;
  /** Новое предложение и отправленное событие; ошибка — `ApiError` с текстом для диспетчера. */
  run: (planId: string) => Promise<{ planId: string; event: DispatcherEvent }>;
  /** Какое предложение сейчас пересчитываем. */
  pendingId: string | null;
}

const REBUILD_FAILED =
  'Не удалось собрать событие заново. Отклоните предложение и добавьте событие ещё раз';

export function useResend({
  headPlanId,
  chain,
  actions,
  sentEvent,
}: {
  headPlanId: string | null;
  chain: Pick<DayChain, 'events'> | null;
  actions: DayActions;
  /** Событие, отправленное из этой вкладки: его тело точное. */
  sentEvent: (planId: string) => DispatcherEvent | null;
}): Resend {
  const queryClient = useQueryClient();
  const [pendingId, setPendingId] = useState<string | null>(null);

  const eventOf = (planId: string) =>
    chain?.events.find((e) => e.result_plan_id === planId && e.event_type !== 'plan_applied') ??
    null;

  const can = (planId: string) => {
    if (!headPlanId) return false;
    if (sentEvent(planId)) return true;
    const event = eventOf(planId);
    return Boolean(event && canRebuild(event));
  };

  const requestOf = async (planId: string, requestId: string | null): Promise<RequestOut | null> => {
    if (!requestId) return null;
    const plan = await queryClient.fetchQuery({
      queryKey: queryKeys.plan(planId),
      queryFn: ({ signal }) => getPlan(planId, signal),
      staleTime: 60_000,
    });
    const scenarioId = plan.scenario_id;
    if (!scenarioId) return null;
    const scenario = await queryClient.fetchQuery({
      queryKey: queryKeys.scenario(scenarioId),
      queryFn: ({ signal }) => getScenario(scenarioId, signal),
      staleTime: 60_000,
    });
    return scenario.requests?.find((r) => r.id === requestId) ?? null;
  };

  const run = async (planId: string) => {
    if (!headPlanId) throw new ApiError(422, 'NO_PLAN', 'У дня нет действующей версии');
    setPendingId(planId);
    try {
      const sent = sentEvent(planId);
      let event: DispatcherEvent | null = sent
        ? ({ ...sent, plan_id: headPlanId } as DispatcherEvent)
        : null;
      if (!event) {
        const source = eventOf(planId);
        if (!source || !canRebuild(source)) throw new ApiError(422, 'REBUILD_FAILED', REBUILD_FAILED);
        const request = needsScenarioRequest(source)
          ? await requestOf(planId, requestIdOf(source))
          : null;
        event = rebuildEvent(source, headPlanId, request);
        if (!event) throw new ApiError(422, 'REBUILD_FAILED', REBUILD_FAILED);
      }
      const result = await actions.sendEvent.mutateAsync(event);
      return { planId: result.plan.plan_id, event };
    } finally {
      setPendingId(null);
    }
  };

  return { can, run, pendingId };
}

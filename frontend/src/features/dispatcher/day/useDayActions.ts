/**
 * Действия дня: построить план, начать день, принять/отклонить предложение, событие, переназначение.
 * После каждой мутации — инвалидация дня, планов, сценариев, событий и календаря (FRONTEND_SPEC §5.3).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { applyEvent, type DispatcherEvent } from '@/api/events';
import { errorMessage } from '@/api/errors';
import { applyPlan, reassign, rejectPlan, runPlan, type ReassignBody } from '@/api/planning';
import { notify } from '@/lib/notify';

export const versionAppliedText = (version: number) =>
  `Версия ${version} применена. Инженеры получили обновление`;

export function useDayActions(date: string) {
  const queryClient = useQueryClient();

  // «Сравнение» не сбрасываем: ключ — id плана, у новой версии он свой, а пересчёт FIFO и
  // «диспетчера» на бэке дорогой (прогон солвера) — после «Отклонить» он не нужен
  const invalidate = () =>
    Promise.all(
      [['days', date], ['plan'], ['scenario'], ['events'], ['calendar']].map((queryKey) =>
        queryClient.invalidateQueries({ queryKey }),
      ),
    );

  const onError = (error: unknown) => notify(errorMessage(error), 'error');

  /** «Построить план»: расчёт и сразу публикация (D-25). */
  const buildPlan = useMutation({
    mutationFn: async (scenarioId: string) => {
      const plan = await runPlan(scenarioId);
      await applyPlan(plan.plan_id);
      return plan;
    },
    onSuccess: async () => {
      await invalidate();
      notify('План построен и опубликован', 'success');
    },
    onError,
  });

  /** «Начать рабочий день» — публикация черновика дня из записей оператора. */
  const startDay = useMutation({
    mutationFn: (draftPlanId: string) => applyPlan(draftPlanId),
    onSuccess: async () => {
      await invalidate();
      notify(versionAppliedText(1), 'success');
    },
    onError,
  });

  /** Принять предложение. Ошибки (в т. ч. STALE_PROPOSAL) разбирает дровер. */
  const acceptProposal = useMutation({
    mutationFn: ({ planId }: { planId: string; nextVersion: number }) => applyPlan(planId),
    onSuccess: async (_result, { nextVersion }) => {
      await invalidate();
      notify(versionAppliedText(nextVersion), 'success');
    },
  });

  const rejectProposal = useMutation({
    mutationFn: (planId: string) => rejectPlan(planId),
    onSuccess: async () => {
      await invalidate();
      notify('Предложение отклонено', 'info');
    },
    onError,
  });

  /** Событие диспетчера (`apply: false`) → предложение. */
  const sendEvent = useMutation({
    mutationFn: (event: DispatcherEvent) => applyEvent(event),
    onSuccess: () => invalidate(),
  });

  /**
   * Ручное переназначение: `/reassign` → сразу `/apply` — решение диспетчера, второго подтверждения
   * не нужно (§6.7). `/apply` нужен и когда бэк уже вернул `applied`: он гасит прежнюю версию.
   */
  const reassignMutation = useMutation({
    mutationFn: async ({ planId, body }: { planId: string; body: ReassignBody; nextVersion: number }) => {
      const result = await reassign(planId, body);
      await applyPlan(result.plan.plan_id);
      return result;
    },
    onSuccess: async (_result, { nextVersion }) => {
      await invalidate();
      notify(versionAppliedText(nextVersion), 'success');
    },
  });

  return {
    invalidate,
    buildPlan,
    startDay,
    acceptProposal,
    rejectProposal,
    sendEvent,
    reassign: reassignMutation,
  };
}

export type DayActions = ReturnType<typeof useDayActions>;

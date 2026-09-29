/**
 * Данные экрана инженера (FRONTEND_SPEC §9.1, §9.3): день с опросом 15 с, маршрут для карты и
 * действия. Ответ действия (`day`) сразу кладём в кэш дня; статус визита меняем оптимистично,
 * ошибка — откат и тост с сообщением бэка.
 */
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  currentVisit,
  hasActiveVisit,
  mergeDay,
  plannedLeft,
  statusAfterFail,
  toEngineerDay,
  withFailedVisits,
  withVisitStatus,
  type EngineerDayModel,
} from '@/adapters/engineerDay';
import { toEngineerRoute } from '@/adapters/engineerRoute';
import { getMyDay, getMyRoute, postAction } from '@/api/engineer';
import { errorMessage, isApiError } from '@/api/errors';
import { queryKeys } from '@/api/queryKeys';
import type { EngineerAction, EngineerActionIn, EngineerMeDay } from '@/api/types';
import { POLL } from '@/config';
import { usePollInterval } from '@/realtime/useRealtime';
import { notify } from '@/lib/notify';
import { isRequestStatus, REQUEST_STATUS_LABEL, type RequestStatus } from '@/lib/statuses';
import { doneToastText, showDoneToast } from './doneToastStore';

/**
 * Заявки, прерванные в этой вкладке: id → статус после «Прервать» и день. Обход ошибки бэка 8.2
 * (`withFailedVisits`): живёт до перезагрузки страницы, дальше решает бэк.
 */
const failedVisits = new Map<string, { status: RequestStatus; date: string | null }>();

function withFailed(raw: EngineerMeDay): EngineerMeDay {
  if (failedVisits.size === 0) return raw;
  const today = new Map<string, RequestStatus>();
  for (const [id, entry] of failedVisits) {
    // другой день (вкладка открыта с вечера) — номера заявок могут совпасть
    if (entry.date && raw.date && entry.date !== raw.date) failedVisits.delete(id);
    else today.set(id, entry.status);
  }
  const { day, resolved } = withFailedVisits(raw, today);
  for (const id of resolved) failedVisits.delete(id);
  return day;
}

export function useEngineerDay() {
  const poll = usePollInterval(POLL.engineer);
  return useQuery({
    queryKey: queryKeys.engineerDay(),
    queryFn: async ({ signal }) => withFailed(await getMyDay(signal)),
    select: toEngineerDay,
    refetchInterval: poll,
  });
}

/** Маршрут по оставшимся точкам (E-04, ссылки в Яндекс Карты). `poll` — пока открыта карта. */
export function useEngineerRoute({ enabled = true, poll = false } = {}) {
  const interval = usePollInterval(POLL.engineer);
  return useQuery({
    queryKey: queryKeys.engineerRoute(),
    queryFn: ({ signal }) => getMyRoute(signal),
    select: toEngineerRoute,
    enabled,
    refetchInterval: poll ? interval : false,
  });
}

const ACTION_KEY = ['engineerAction'] as const;

/** Статус визита сразу после нажатия — до ответа бэка. */
const OPTIMISTIC: Partial<Record<EngineerAction, RequestStatus>> = {
  en_route: 'en_route',
  start: 'in_progress',
  complete: 'done',
};

/** Тосты после действий (§9.2): тексты — дословно из ТЗ. */
const SUCCESS_TEXT: Partial<Record<EngineerAction, string>> = {
  fail: 'Отправлено диспетчеру. Можно ехать к следующей заявке',
  incident: 'Сообщили диспетчеру',
  unavailable: 'Сообщили диспетчеру',
  transport_changed: 'Смена транспорта — диспетчеру на решение',
};

interface ActionContext {
  previous?: EngineerMeDay;
}

/**
 * Текст ошибки нажатия. На `ILLEGAL_TRANSITION` бэк пишет технически («Нельзя выполнить 'en_route'
 * из статуса 'done'») — называем статус заявки словами; день после ошибки перезапрашиваем.
 */
function actionErrorText(error: unknown): string {
  if (isApiError(error) && error.code === 'ILLEGAL_TRANSITION') {
    const details = (error.details ?? {}) as { status?: unknown };
    if (isRequestStatus(details.status)) {
      return `Заявка уже в статусе «${REQUEST_STATUS_LABEL[details.status]}». Обновили маршрут`;
    }
  }
  return errorMessage(error);
}

/**
 * Действие инженера. Тосты и тост «Заявка … выполнена» — здесь: они должны появиться, даже если
 * экран с кнопкой уже сменился. `COMMENT_REQUIRED` показывает сама шторка — подсветкой поля.
 */
export function useEngineerAction() {
  const queryClient = useQueryClient();
  const dayKey = queryKeys.engineerDay();

  return useMutation<
    Awaited<ReturnType<typeof postAction>>,
    Error,
    EngineerActionIn,
    ActionContext
  >({
    mutationKey: ACTION_KEY,
    mutationFn: (body) => postAction(body),
    onMutate: async (body) => {
      // идущий опрос не должен затереть ни оптимистичный статус, ни ответ действия
      await queryClient.cancelQueries({ queryKey: dayKey });
      const previous = queryClient.getQueryData<EngineerMeDay>(dayKey);
      const status =
        body.action === 'fail' ? statusAfterFail(body.payload?.reason) : OPTIMISTIC[body.action];
      if (previous && status && body.request_id) {
        queryClient.setQueryData(dayKey, withVisitStatus(previous, body.request_id, status));
      }
      return { previous };
    },
    onError: (error, _body, context) => {
      if (context?.previous) queryClient.setQueryData(dayKey, context.previous);
      void queryClient.invalidateQueries({ queryKey: dayKey });
      if (isApiError(error) && error.code === 'COMMENT_REQUIRED') return;
      notify(actionErrorText(error), 'error');
    },
    onSuccess: (result, body, context) => {
      if (body.action === 'fail' && body.request_id) {
        failedVisits.set(body.request_id, {
          status: statusAfterFail(body.payload?.reason),
          date: context?.previous?.date ?? null,
        });
      }
      const day = result?.day ?? undefined;
      if (day) {
        queryClient.setQueryData<EngineerMeDay>(dayKey, (cached) => withFailed(mergeDay(cached, day)));
      } else void queryClient.invalidateQueries({ queryKey: dayKey });
      void queryClient.invalidateQueries({ queryKey: queryKeys.engineerRoute() });

      if (body.action === 'complete' && body.request_id) {
        const after = toEngineerDay(
          day ?? context?.previous ?? { engineer: { id: '' }, summary: {} },
        );
        const done = after.visits.find((visit) => visit.id === body.request_id);
        const next = currentVisit({
          visits: after.visits.filter((visit) => visit.id !== body.request_id),
          activeRequestId: after.activeRequestId === body.request_id ? null : after.activeRequestId,
        });
        showDoneToast(doneToastText(body.request_id, done ?? null, next));
      }
      const text = SUCCESS_TEXT[body.action];
      if (text) notify(text, 'success');
    },
  });
}

/** Идёт действие инженера — кнопки статуса неактивны (двойное нажатие исключено). */
export const useActionPending = () => useIsMutating({ mutationKey: ACTION_KEY }) > 0;

/**
 * «Завершить смену» (§9.2, D-31): запланированных нет — сразу `shift_end`, иначе — подтверждение
 * «Осталось N заявок». Пока заявка в пути или в работе — нельзя (бэк вернёт 409).
 */
export function useShiftEnd(day: EngineerDayModel | undefined, confirm: () => void) {
  const action = useEngineerAction();
  const request = () => {
    if (!day || action.isPending) return;
    // заявка в пути или в работе — окно объяснит, что сначала закрыть её; остались заявки — предупредит
    if (!hasActiveVisit(day) && plannedLeft(day) === 0) action.mutate({ action: 'shift_end' });
    else confirm();
  };
  return { request, pending: action.isPending };
}

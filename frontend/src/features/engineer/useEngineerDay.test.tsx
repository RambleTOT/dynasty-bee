import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { postAction } from '@/api/engineer';
import { ApiError } from '@/api/errors';
import { createQueryClient } from '@/api/queryClient';
import { queryKeys } from '@/api/queryKeys';
import type { EngineerMeDay, EngineerVisit } from '@/api/types';
import { notify } from '@/lib/notify';
import { hideDoneToast, useDoneToast } from './doneToastStore';
import { useEngineerAction } from './useEngineerDay';

vi.mock('@/api/engineer', () => ({
  getMyDay: vi.fn(),
  getMyRoute: vi.fn(),
  postAction: vi.fn(),
}));
vi.mock('@/lib/notify', () => ({ notify: vi.fn() }));

const visit = (id: string, sequence: number, status: string, extra: Partial<EngineerVisit> = {}) =>
  ({
    request_id: id,
    sequence,
    status,
    flags: [],
    address: `Город Москва, ул.Артюхиной, д. ${sequence}, кв. 7`,
    window: '14:00-16:00',
    duration_minutes: 30,
    leg_km: 1.6,
    gigabit: false,
    why_you: '',
    ...extra,
  }) as EngineerVisit;

const rawDay = (visits: EngineerVisit[], active: string | null = null): EngineerMeDay => ({
  date: '2026-09-29',
  plan_published: true,
  engineer: { id: 'E01', name: 'Мельников', shift_status: 'on_shift' },
  summary: { total: visits.length },
  active_request_id: active,
  visits,
  banners: [],
});

const dayKey = queryKeys.engineerDay();

type ActionResult = Awaited<ReturnType<typeof postAction>>;

/** Ответ POST /engineers/me/actions: `day` — день после действия. */
const response = (action: string, day?: EngineerMeDay) =>
  ({ engineer_id: 'E01', action, status: 'ok', day }) as unknown as ActionResult;

function setup(initial: EngineerMeDay) {
  const client = createQueryClient();
  client.setQueryData(dayKey, initial);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => ({ action: useEngineerAction(), toast: useDoneToast() }), {
    wrapper,
  });
  const cached = () => client.getQueryData<EngineerMeDay>(dayKey);
  return { client, result, cached };
}

beforeEach(() => {
  vi.mocked(postAction).mockReset();
  vi.mocked(notify).mockClear();
});

afterEach(() => {
  act(() => hideDoneToast());
});

describe('useEngineerAction', () => {
  it('статус меняется сразу, ответ бэка (day) кладём в кэш', async () => {
    const initial = rawDay([visit('A', 1, 'planned'), visit('B', 2, 'planned')]);
    const fromServer = rawDay([visit('A', 1, 'en_route'), visit('B', 2, 'planned')], 'A');
    let resolve: (value: ActionResult) => void = () => {};
    vi.mocked(postAction).mockReturnValue(
      new Promise<ActionResult>((r) => {
        resolve = r;
      }),
    );
    const { result, cached } = setup(initial);

    act(() => result.current.action.mutate({ action: 'en_route', request_id: 'A' }));
    await waitFor(() => expect(cached()?.visits?.[0].status).toBe('en_route'));
    expect(cached()?.active_request_id).toBe('A');
    expect(postAction).toHaveBeenCalledWith({ action: 'en_route', request_id: 'A' });

    act(() => resolve(response('en_route', fromServer)));
    await waitFor(() => expect(result.current.action.isSuccess).toBe(true));
    expect(cached()).toEqual(fromServer);
  });

  it('409 ILLEGAL_TRANSITION — откат статуса и тост с сообщением бэка', async () => {
    const initial = rawDay([visit('A', 1, 'planned')]);
    vi.mocked(postAction).mockRejectedValue(
      new ApiError(409, 'ILLEGAL_TRANSITION', 'Сначала нажмите «В работе»'),
    );
    const { result, cached } = setup(initial);

    act(() => result.current.action.mutate({ action: 'complete', request_id: 'A' }));
    await waitFor(() => expect(result.current.action.isError).toBe(true));

    expect(cached()?.visits?.[0].status).toBe('planned');
    expect(notify).toHaveBeenCalledWith('Сначала нажмите «В работе»', 'error');
  });

  it('409 ILLEGAL_TRANSITION со статусом — статус заявки словами', async () => {
    vi.mocked(postAction).mockRejectedValue(
      new ApiError(409, 'ILLEGAL_TRANSITION', "Нельзя выполнить 'en_route' из статуса 'done'", {
        request_id: 'A',
        status: 'done',
      }),
    );
    const { result } = setup(rawDay([visit('A', 1, 'planned')]));

    act(() => result.current.action.mutate({ action: 'en_route', request_id: 'A' }));
    await waitFor(() => expect(result.current.action.isError).toBe(true));
    expect(notify).toHaveBeenCalledWith('Заявка уже в статусе «Выполнена». Обновили маршрут', 'error');
  });

  it('COMMENT_REQUIRED — без тоста: поле подсвечивает шторка', async () => {
    vi.mocked(postAction).mockRejectedValue(
      new ApiError(422, 'COMMENT_REQUIRED', 'Опишите причину'),
    );
    const { result } = setup(rawDay([visit('A', 1, 'in_progress')], 'A'));
    act(() =>
      result.current.action.mutate({
        action: 'fail',
        request_id: 'A',
        payload: { reason: 'other' },
      }),
    );
    await waitFor(() => expect(result.current.action.isError).toBe(true));
    expect(notify).not.toHaveBeenCalled();
  });

  it('«Выполнить задачу» — тост с фактом и следующей заявкой', async () => {
    const initial = rawDay(
      [visit('305871402', 4, 'in_progress'), visit('305866318', 5, 'planned')],
      '305871402',
    );
    const after = rawDay(
      [
        visit('305871402', 4, 'done', { actual_start: '14:10', actual_end: '15:18' }),
        visit('305866318', 5, 'planned'),
      ],
      null,
    );
    vi.mocked(postAction).mockResolvedValue(response('complete', after));
    const { result } = setup(initial);

    act(() => result.current.action.mutate({ action: 'complete', request_id: '305871402' }));
    await waitFor(() => expect(result.current.toast).not.toBeNull());
    expect(result.current.toast).toEqual({
      title: 'Заявка №…1402 выполнена',
      description: '14:10–15:18 · следующая — ул.Артюхиной, д. 5, 1,6 км',
    });
  });

  it('«Выполнить задачу» без фактов ⏳ — тост без времени', async () => {
    vi.mocked(postAction).mockResolvedValue(response('complete'));
    const { result } = setup(
      rawDay([visit('A1', 1, 'in_progress'), visit('B2', 2, 'planned')], 'A1'),
    );

    act(() => result.current.action.mutate({ action: 'complete', request_id: 'A1' }));
    await waitFor(() => expect(result.current.toast).not.toBeNull());
    expect(result.current.toast?.description).toBe('следующая — ул.Артюхиной, д. 2, 1,6 км');
  });

  it('«Прервать»: бэк оставил заявку «В пути» — держим «Отменяется», текущая — следующая (8.2)', async () => {
    const stale = rawDay([visit('F1', 1, 'en_route'), visit('F2', 2, 'planned')], 'F1');
    vi.mocked(postAction).mockResolvedValue(response('fail', stale));
    const { result, cached } = setup(stale);

    act(() =>
      result.current.action.mutate({ action: 'fail', request_id: 'F1', payload: { reason: 'client_refused' } }),
    );
    await waitFor(() => expect(result.current.action.isSuccess).toBe(true));
    expect(cached()?.visits?.map((v) => v.status)).toEqual(['cancel_pending', 'planned']);
    expect(cached()?.active_request_id).toBeNull();
  });

  it('«Прервать» — тост «Отправлено диспетчеру…»', async () => {
    vi.mocked(postAction).mockResolvedValue(response('fail'));
    const { result } = setup(rawDay([visit('A', 1, 'in_progress')], 'A'));
    act(() =>
      result.current.action.mutate({
        action: 'fail',
        request_id: 'A',
        payload: { reason: 'client_refused' },
      }),
    );
    await waitFor(() => expect(result.current.action.isSuccess).toBe(true));
    expect(notify).toHaveBeenCalledWith(
      'Отправлено диспетчеру. Можно ехать к следующей заявке',
      'success',
    );
  });
});

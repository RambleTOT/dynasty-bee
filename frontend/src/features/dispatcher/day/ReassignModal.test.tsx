import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  makePlan,
  makePoint,
  makeRequest,
  makeRoute,
  makeScenario,
} from '@/adapters/__fixtures__/day';
import {
  overlayEngineers,
  overlayModel,
  overlayPlan,
  overlayRequests,
} from '@/adapters/__fixtures__/dayOverlays';
import { getScenario } from '@/api/data';
import { ApiError } from '@/api/errors';
import { applyPlan, checkReassign, getPlan, reassign, type ReassignBody } from '@/api/planning';
import type { ReassignCheckResponse, ReplanResult } from '@/api/types';
import { dismissAll } from '@/lib/notify';
import { renderDay, withDayActions } from '@/test/dispatcherDay';
import { ReassignModal } from './ReassignModal';
import type { DraftRequest } from './useDraftTimeline';

vi.mock('@/api/planning', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/planning')>()),
  checkReassign: vi.fn(),
  reassign: vi.fn(),
  applyPlan: vi.fn(),
  getPlan: vi.fn(),
}));
vi.mock('@/api/data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/data')>()),
  getScenario: vi.fn(),
}));

afterEach(() => {
  act(() => dismissAll());
  vi.clearAllMocks();
});

const ORDER = '305800002';

function check(
  engineerId: string,
  patch: Partial<ReassignCheckResponse> = {},
): ReassignCheckResponse {
  return {
    order_id: ORDER,
    to_engineer_id: engineerId,
    feasible: true,
    checks: {
      skill: { ok: true, text: '' },
      transport: { ok: true, text: '' },
      time: { ok: true, text: '' },
    },
    new_start: '12:40',
    shifted_visits: [],
    late_visits: [],
    delta_km: 2.8,
    ...patch,
  };
}

/** Ответы check по бригаде и позиции: «e2» — лучшая позиция, «e2@2» — явная. */
function mockChecks(answers: Record<string, ReassignCheckResponse>) {
  vi.mocked(checkReassign).mockImplementation(async (_planId: string, body: ReassignBody) => {
    const key =
      body.position != null ? `${body.to_engineer_id}@${body.position}` : body.to_engineer_id;
    const answer = answers[key];
    if (!answer) throw new ApiError(422, 'VALIDATION_ERROR', `нет ответа для ${key}`);
    return answer;
  });
}

function mockApply() {
  vi.mocked(reassign).mockResolvedValue({
    plan: { plan_id: 'P2' },
    status: 'applied',
  } as ReplanResult);
  vi.mocked(applyPlan).mockResolvedValue({ plan_id: 'P2', status: 'applied' });
}

function renderModal({
  requestId = ORDER,
  basePlanId = null as string | null,
  onPreview = undefined as ((draft: DraftRequest) => void) | undefined,
} = {}) {
  const onClose = vi.fn();
  renderDay(
    withDayActions('2026-09-29', (actions) => (
      <ReassignModal
        requestId={requestId}
        basePlanId={basePlanId}
        model={overlayModel()}
        actions={actions}
        onPreview={onPreview}
        onClose={onClose}
      />
    )),
  );
  return onClose;
}

const candidate = (name: string) => screen.getByRole('button', { name: new RegExp(name) });

describe('DS-08 «Ручное переназначение»', () => {
  it('ближайшие проверяются сразу; «Подходит» → «Применить» → reassign и сразу apply', async () => {
    mockChecks({ e2: check('e2') });
    mockApply();
    const onClose = renderModal();

    const dialog = screen.getByRole('dialog', { name: `Заявка №${ORDER} → инженер` });
    expect(
      within(dialog).getByText('Подключение · окно 12–14 · ул. Шоссейная, д. 42'),
    ).toBeInTheDocument();
    expect(await within(dialog).findByText('Все три ограничения соблюдены')).toBeInTheDocument();

    // текущая бригада (Соколов) и снятая со смены (Каушнян) — не кандидаты; отсеянные — внизу с меткой
    expect(within(dialog).queryByRole('button', { name: /Соколов/ })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: /Каушнян/ })).toBeNull();
    expect(candidate('Мельников')).toHaveAttribute('aria-pressed', 'true');
    expect(candidate('Мельников')).toHaveTextContent('Подходит');
    expect(candidate('Перов')).toHaveTextContent('пешком · 0,1 км');
    expect(candidate('Перов')).toHaveTextContent('Нет авто');
    // D-38: у бригады без заявок в текущем плане — «Не работает сегодня», выбрать можно
    expect(candidate('Перов')).toHaveTextContent('Не работает сегодня');
    expect(candidate('Перов')).toHaveTextContent('вызов с выходного — решение диспетчера');
    expect(candidate('Мельников')).not.toHaveTextContent('Не работает сегодня');
    expect(candidate('Попов')).toHaveTextContent('Нет навыка');
    // проверка — только у прошедших фильтр на фронте
    expect(checkReassign).toHaveBeenCalledTimes(1);
    // «сейчас» дня — полем time (п. 47): бэк не ставит визит раньше него
    expect(checkReassign).toHaveBeenCalledWith(
      'P1',
      { order_id: ORDER, to_engineer_id: 'e2', time: '14:32' },
      expect.anything(),
    );

    const position = within(dialog).getByRole('combobox', { name: 'Позиция в маршруте' });
    expect(position).toHaveValue('0');
    expect(
      within(position).getByRole('option', { name: 'В начало маршрута · начало 12:40' }),
    ).toBeInTheDocument();

    for (const chip of ['Уйдут в просрочку: нет', 'Пробег +2,8 км', 'Инженеров 0']) {
      expect(within(dialog).getByText(chip)).toBeInTheDocument();
    }

    fireEvent.click(within(dialog).getByRole('button', { name: 'Применить' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    // позицию передаём явно — ту, что нашла проверка: без неё бэк вставит заявку в начало маршрута
    expect(reassign).toHaveBeenCalledWith('P1', {
      order_id: ORDER,
      to_engineer_id: 'e2',
      position: 0,
      force: false,
      time: '14:32',
    });
    expect(applyPlan).toHaveBeenCalledWith('P2');
    expect(
      await screen.findByText('Версия 5 применена. Инженеры получили обновление'),
    ).toBeInTheDocument();
  });

  it('начало раньше «сейчас» — предупреждение; «Показать на таймлайне» — черновик переназначения', async () => {
    mockChecks({ e2: check('e2', { shifted_visits: [{ order_id: 'x', delta_min: 5 }] }) });
    const onPreview = vi.fn();
    renderModal({ onPreview });
    const dialog = screen.getByRole('dialog', { name: `Заявка №${ORDER} → инженер` });
    // часы дня 14:32, проверка ставит начало на 12:40
    expect(
      await within(dialog).findByText(/Начало 12:40 — раньше текущего времени 14:32/),
    ).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Показать на таймлайне' }));
    expect(onPreview).toHaveBeenCalledTimes(1);
    const draft = onPreview.mock.calls[0][0] as Extract<DraftRequest, { kind: 'reassign' }>;
    expect(draft.kind).toBe('reassign');
    expect(draft.caption).toMatch(new RegExp(`^Черновик: №${ORDER} → .+, начало 12:40$`));
    expect(draft.model.requestById.get(ORDER)?.engineerId).toBe('e2');
    expect(draft.overlay.moved.has(ORDER)).toBe(true);
  });

  it('отсеянную можно выбрать: нарушения по трём ограничениям, «Применить с нарушением» — после подтверждения, force', async () => {
    mockChecks({
      e2: check('e2'),
      e4: check('e4', {
        feasible: false,
        new_start: '14:40',
        checks: {
          transport: { ok: false, text: 'Нужен автомобиль' },
          time: { ok: false, text: '' },
        },
        late_visits: [{ order_id: '305800004', late_min: 25 }],
        delta_km: 4.2,
      }),
    });
    mockApply();
    const onClose = renderModal();
    await screen.findByText('Все три ограничения соблюдены');

    fireEvent.click(candidate('Перов'));
    expect(await screen.findByText('Время: начало 14:40 вне окна 12–14')).toBeInTheDocument();
    expect(screen.getByText('Ресурс: нужен автомобиль')).toBeInTheDocument();
    // метка отсеянного не меняется и после проверки (§8.2, п. 7)
    expect(candidate('Перов')).toHaveTextContent('Нет авто');
    expect(candidate('Перов')).toHaveTextContent('пешком · начало 14:40');
    for (const chip of ['Уйдут в просрочку: №305800004', 'Пробег +4,2 км', 'Инженеров +1']) {
      expect(screen.getByText(chip)).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: 'Применить' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Применить с нарушением' }));
    expect(screen.getByText(/^Назначить с нарушением ограничений\?/)).toBeInTheDocument();
    expect(reassign).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Применить с нарушением' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(reassign).toHaveBeenCalledWith('P1', {
      order_id: ORDER,
      to_engineer_id: 'e4',
      position: 0,
      force: true,
      time: '14:32',
    });
  });

  it('«Позиция в маршруте» — повторная проверка с position; метка по новому ответу', async () => {
    mockChecks({
      e2: check('e2'),
      'e2@2': check('e2', {
        feasible: false,
        new_start: '16:40',
        checks: { time: { ok: false, text: '' } },
      }),
    });
    mockApply();
    renderModal();
    await screen.findByText('Все три ограничения соблюдены');

    const position = screen.getByRole('combobox', { name: 'Позиция в маршруте' });
    expect(
      within(position)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['В начало маршрута · начало 12:40', 'После №305800003', 'После №305800004']);
    fireEvent.change(position, { target: { value: '2' } });

    expect(await screen.findByText('Время: начало 16:40 вне окна 12–14')).toBeInTheDocument();
    expect(checkReassign).toHaveBeenLastCalledWith(
      'P1',
      { order_id: ORDER, to_engineer_id: 'e2', position: 2, time: '14:32' },
      expect.anything(),
    );
    expect(candidate('Мельников')).toHaveTextContent('Вне окна');
    expect(
      within(position).getByRole('option', { name: 'После №305800004 · начало 16:40' }),
    ).toBeInTheDocument();
  });

  it('из предложения (DS-07 «Править вручную»): база — предложенный план и его сценарий', async () => {
    const urgent = makeRequest({
      id: 'U-0427',
      type_bk: 'Глобальная проблема',
      type_hd: 'Авария',
      required_skill: 'emergency',
      required_transport: 'car',
      window_start: '13:10',
      window_end: '22:00',
      address: 'ул. Юных Ленинцев, д. 83',
    });
    vi.mocked(getPlan).mockResolvedValue(
      makePlan({
        plan_id: 'P9',
        scenario_id: 'S9',
        status: 'proposed',
        routes: [
          ...(overlayPlan.routes ?? []),
          makeRoute('e4', [
            makePoint({ request_id: 'U-0427', sequence: 1, start: '13:40', end: '15:00' }),
          ]),
        ],
      }),
    );
    vi.mocked(getScenario).mockResolvedValue(
      makeScenario({
        scenario_id: 'S9',
        engineers: overlayEngineers,
        requests: [...overlayRequests, urgent],
      }),
    );
    vi.mocked(checkReassign).mockResolvedValue(check('e1', { order_id: 'U-0427' }));
    renderModal({ requestId: 'U-0427', basePlanId: 'P9' });

    const dialog = screen.getByRole('dialog', { name: 'Заявка №U-0427 → инженер' });
    expect(
      await within(dialog).findByText(
        'Глобальная проблема · окно 13:10–22 · ул. Юных Ленинцев, д. 83',
      ),
    ).toBeInTheDocument();
    await within(dialog).findByText('Все три ограничения соблюдены');
    expect(getPlan).toHaveBeenCalledWith('P9', expect.anything());
    expect(getScenario).toHaveBeenCalledWith('S9', expect.anything());
    // навык «Авария» есть только у Соколова; текущая бригада срочной заявки в предложении — Перов
    expect(checkReassign).toHaveBeenCalledWith(
      'P9',
      { order_id: 'U-0427', to_engineer_id: 'e1', time: '14:32' },
      expect.anything(),
    );
    expect(within(dialog).queryByRole('button', { name: /Перов/ })).toBeNull();
  });

  it('ошибка применения — текст бэка в окне, окно остаётся открытым', async () => {
    mockChecks({ e2: check('e2') });
    vi.mocked(reassign).mockRejectedValue(
      new ApiError(409, 'STALE_PROPOSAL', 'План уже изменился'),
    );
    const onClose = renderModal();
    await screen.findByText('Все три ограничения соблюдены');
    fireEvent.click(screen.getByRole('button', { name: 'Применить' }));
    expect(await screen.findByText('План уже изменился')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(applyPlan).not.toHaveBeenCalled();
  });
});

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makePlan } from '@/adapters/__fixtures__/day';
import { overlayEngineers, overlayModel } from '@/adapters/__fixtures__/dayOverlays';
import { addEngineers, getScenarioEngineers, patchEngineer } from '@/api/data';
import { ApiError } from '@/api/errors';
import { applyEvent } from '@/api/events';
import { applyPlan, checkExtendResource, extendResource, runPlan } from '@/api/planning';
import type { ExtendResourceResponse, ReplanResult, ScenarioSummary } from '@/api/types';
import { FEATURES } from '@/config';
import { dismissAll } from '@/lib/notify';
import { renderDay, withDayActions } from '@/test/dispatcherDay';
import { RosterDrawer } from './RosterDrawer';

vi.mock('@/api/data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/data')>()),
  getScenarioEngineers: vi.fn(),
  patchEngineer: vi.fn(),
  addEngineers: vi.fn(),
}));
vi.mock('@/api/planning', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/planning')>()),
  runPlan: vi.fn(),
  applyPlan: vi.fn(),
  extendResource: vi.fn(),
  checkExtendResource: vi.fn(),
}));
vi.mock('@/api/events', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/events')>()),
  applyEvent: vi.fn(),
}));
// флаг правки бэка §12 закрепляем в каждом тесте: значения по умолчанию на стенде меняются
vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config')>();
  return {
    ...actual,
    FEATURES: { ...actual.FEATURES, addEngineerAfterPublish: false, extendResourceCheck: false },
  };
});

const flags = FEATURES as Record<keyof typeof FEATURES, boolean>;

beforeEach(() => {
  flags.addEngineerAfterPublish = false;
  flags.extendResourceCheck = false;
  vi.mocked(getScenarioEngineers).mockResolvedValue(overlayEngineers);
});

afterEach(() => {
  act(() => dismissAll());
  vi.clearAllMocks();
});

function renderDrawer(planState: 'none' | 'draft' | 'applied', withAddForm = false) {
  const onClose = vi.fn();
  const onProposal = vi.fn();
  renderDay(
    withDayActions('2026-09-29', (actions) => (
      <RosterDrawer
        model={overlayModel({ planState })}
        withAddForm={withAddForm}
        actions={actions}
        onProposal={onProposal}
        onClose={onClose}
      />
    )),
  );
  return { onClose, onProposal };
}

const transport = (name: string) => screen.getByRole('combobox', { name: `Транспорт: ${name}` });
const inDay = (name: string) => screen.getByRole('switch', { name: `В день: ${name}` });
const recalc = () => screen.getByRole('button', { name: 'Пересчитать план' });

describe('DS-09 «Состав и ресурсы»', () => {
  it('таблица по ростеру: навыки, транспорт, смена из данных, выключенная бригада', async () => {
    renderDrawer('applied');
    const drawer = screen.getByRole('dialog', { name: 'Состав и ресурсы' });
    expect(within(drawer).getByText('Восток · Вт, 29 сентября · 5 бригад')).toBeInTheDocument();
    for (const head of ['ИНЖЕНЕР · НАВЫКИ', 'ТРАНСПОРТ', 'СМЕНА', 'В ДЕНЬ']) {
      expect(within(drawer).getByText(head)).toBeInTheDocument();
    }
    expect(transport('Бригада Попов')).toHaveValue('public_transport');
    expect(inDay('Бригада Каушнян')).not.toBeChecked();
    expect(within(drawer).getAllByText('10:00–22:00')).toHaveLength(5);
    await waitFor(() => expect(getScenarioEngineers).toHaveBeenCalledWith('S0', expect.anything()));
    // extend-resource сохраняет предложение — сами не вызываем, только по кнопке
    expect(within(drawer).getByText('Не назначена 1 заявка')).toBeInTheDocument();
    expect(
      within(drawer).getByRole('button', { name: 'Рассчитать, кого не хватает' }),
    ).toBeInTheDocument();
    expect(extendResource).not.toHaveBeenCalled();
    expect(
      within(drawer).getByText('Изменения станут событием и придут предложением'),
    ).toBeInTheDocument();
    expect(recalc()).toBeDisabled();
  });

  it('до публикации: PATCH изменённых и POST новых → расчёт и сразу публикация (D-25)', async () => {
    vi.mocked(patchEngineer).mockResolvedValue({} as ScenarioSummary);
    vi.mocked(addEngineers).mockResolvedValue({} as ScenarioSummary);
    vi.mocked(runPlan).mockResolvedValue(makePlan({ plan_id: 'P2' }));
    vi.mocked(applyPlan).mockResolvedValue({ plan_id: 'P2', status: 'applied' });
    const { onClose } = renderDrawer('none', true);

    // форма добавления открыта сразу; смена по умолчанию — самая частая в ростере
    expect(screen.getByLabelText('Смена с')).toHaveValue('10:00');
    expect(screen.getByLabelText('до')).toHaveValue('22:00');
    fireEvent.click(screen.getByRole('button', { name: 'Добавить в состав' }));
    expect(screen.getByText('Укажите имя')).toBeInTheDocument();
    expect(screen.getByText('Выберите хотя бы один навык')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Имя' }), {
      target: { value: 'Бригада Иванов' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Аварийные работы' }));
    fireEvent.click(screen.getByRole('button', { name: 'Добавить в состав' }));
    expect(screen.getByText('Бригада Иванов')).toBeInTheDocument();

    fireEvent.change(transport('Бригада Соколов'), { target: { value: 'walk' } });
    fireEvent.click(inDay('Бригада Попов'));
    expect(
      screen.getByText('План будет построен и опубликован с новым составом'),
    ).toBeInTheDocument();
    fireEvent.click(recalc());

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(vi.mocked(patchEngineer).mock.calls).toEqual([
      ['S0', 'e1', { transport: 'walk' }],
      ['S0', 'e3', { available: false }],
    ]);
    expect(addEngineers).toHaveBeenCalledWith('S0', [
      {
        name: 'Бригада Иванов',
        skills: ['emergency'],
        transport: 'car',
        shift_start: '10:00',
        shift_end: '22:00',
        start: 'office',
      },
    ]);
    expect(runPlan).toHaveBeenCalledWith('S0');
    expect(applyPlan).toHaveBeenCalledWith('P2');
    expect(await screen.findByText('План построен и опубликован')).toBeInTheDocument();
  });

  it('черновик дня из записей оператора: пересчёт без публикации', async () => {
    vi.mocked(patchEngineer).mockResolvedValue({} as ScenarioSummary);
    vi.mocked(runPlan).mockResolvedValue(makePlan({ plan_id: 'P2', status: 'draft' }));
    const { onClose } = renderDrawer('draft');
    fireEvent.click(inDay('Бригада Каушнян'));
    fireEvent.click(recalc());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(patchEngineer).toHaveBeenCalledWith('S0', 'e5', { available: true });
    expect(runPlan).toHaveBeenCalledWith('S0');
    expect(applyPlan).not.toHaveBeenCalled();
    expect(await screen.findByText('План пересчитан')).toBeInTheDocument();
  });

  it('после публикации: одно изменение → событие apply: false → предложение (DS-07)', async () => {
    vi.mocked(applyEvent).mockResolvedValue({
      status: 'proposed',
      plan: { plan_id: 'P3' },
    } as ReplanResult);
    const { onProposal } = renderDrawer('applied', true);
    // флаг §12 выключен: формы и «Добавить инженера» после публикации нет
    expect(screen.queryByRole('textbox', { name: 'Имя' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Добавить инженера' })).toBeNull();

    fireEvent.click(inDay('Бригада Мельников'));
    // по одному изменению за раз: остальное заблокировано
    expect(screen.getByText('После публикации — по одному изменению за раз')).toBeInTheDocument();
    expect(transport('Бригада Соколов')).toBeDisabled();
    expect(transport('Бригада Мельников')).toBeDisabled();
    expect(inDay('Бригада Попов')).toBeDisabled();
    expect(inDay('Бригада Мельников')).toBeEnabled();

    fireEvent.click(recalc());
    await waitFor(() => expect(onProposal).toHaveBeenCalledWith('P3'));
    expect(applyEvent).toHaveBeenCalledWith({
      type: 'engineer_unavailable',
      plan_id: 'P1',
      event_time: '14:32',
      engineer_id: 'e2',
    });
    expect(patchEngineer).not.toHaveBeenCalled();
  });

  it('смена транспорта после публикации — transport_changed; ошибка бэка — в дровере', async () => {
    vi.mocked(applyEvent).mockRejectedValue(
      new ApiError(409, 'STALE_PROPOSAL', 'План уже изменился'),
    );
    const { onProposal } = renderDrawer('applied');
    fireEvent.change(transport('Бригада Попов'), { target: { value: 'car' } });
    fireEvent.click(recalc());
    expect(await screen.findByText('План уже изменился')).toBeInTheDocument();
    expect(applyEvent).toHaveBeenCalledWith({
      type: 'transport_changed',
      plan_id: 'P1',
      event_time: '14:32',
      engineer_id: 'e3',
      params: { transport: 'car' },
    });
    expect(onProposal).not.toHaveBeenCalled();
  });

  it('флаг addEngineerAfterPublish (P1-6): новая бригада — событие engineer_added, id выдаёт бэк', async () => {
    flags.addEngineerAfterPublish = true;
    vi.mocked(applyEvent).mockResolvedValue({
      status: 'proposed',
      plan: { plan_id: 'P4' },
    } as ReplanResult);
    const { onProposal } = renderDrawer('applied', true);
    await waitFor(() => expect(getScenarioEngineers).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByRole('textbox', { name: 'Имя' }), {
      target: { value: 'Бригада Иванов' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Аварийные работы' }));
    fireEvent.click(screen.getByRole('button', { name: 'Добавить в состав' }));
    // новая бригада — единственное изменение: правки ростера заблокированы
    expect(inDay('Бригада Соколов')).toBeDisabled();
    fireEvent.click(recalc());

    await waitFor(() => expect(onProposal).toHaveBeenCalledWith('P4'));
    expect(addEngineers).not.toHaveBeenCalled();
    expect(applyEvent).toHaveBeenCalledWith({
      type: 'engineer_added',
      plan_id: 'P1',
      event_time: '14:32',
      engineer: expect.objectContaining({
        name: 'Бригада Иванов',
        skills: ['emergency'],
        start: { kind: 'office' },
        latitude: 55.72,
        longitude: 37.82,
      }),
    });
  });

  it('«Рассчитать, кого не хватает» → extend-resource с бригадой-кандидатом → «Открыть предложение»', async () => {
    vi.mocked(extendResource).mockResolvedValue({
      plan: makePlan({ plan_id: 'P5', status: 'proposed' }),
      closed: ['305800007'],
      still_unassigned: [],
      cost: { extra_engineers: 1 },
    } as unknown as ExtendResourceResponse);
    const { onProposal } = renderDrawer('applied');
    fireEvent.click(screen.getByRole('button', { name: 'Рассчитать, кого не хватает' }));
    expect(
      await screen.findByText(
        'Чтобы назначить 1 неназначенную, не хватает +1 инженера с навыком «Аварийные работы» и на автомобиле',
      ),
    ).toBeInTheDocument();
    expect(extendResource).toHaveBeenCalledWith(
      'P1',
      ['305800007'],
      expect.objectContaining({ skills: ['emergency'], transport: 'car', latitude: 55.72, longitude: 37.82 }),
    );
    expect(checkExtendResource).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Открыть предложение' }));
    expect(onProposal).toHaveBeenCalledWith('P5');
  });

  it('P1-5: расчёт без сохранения → «Добавить такую бригаду» — форма уже заполнена', async () => {
    flags.extendResourceCheck = true;
    flags.addEngineerAfterPublish = true;
    vi.mocked(checkExtendResource).mockResolvedValue({
      closed: ['305800007'],
      still_unassigned: [],
      cost: { extra_engineers: 1 },
    });
    renderDrawer('applied');
    await waitFor(() => expect(getScenarioEngineers).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Рассчитать, кого не хватает' }));
    await screen.findByText(/^Чтобы назначить 1 неназначенную/);
    expect(extendResource).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Открыть предложение' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Добавить такую бригаду' }));
    expect(screen.getByRole('checkbox', { name: 'Аварийные работы' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Локальные работы' })).not.toBeChecked();
  });

  it('ответ без closed — «Не удалось рассчитать добор ресурса», без кнопок', async () => {
    vi.mocked(extendResource).mockResolvedValue({
      plan: makePlan({ plan_id: 'P6', status: 'proposed' }),
      cost: {},
    } as unknown as ExtendResourceResponse);
    renderDrawer('applied');
    fireEvent.click(screen.getByRole('button', { name: 'Рассчитать, кого не хватает' }));
    expect(await screen.findByText('Не удалось рассчитать добор ресурса')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Открыть предложение' })).toBeNull();
  });

  it('до публикации рекомендации нет: правим состав и пересчитываем', () => {
    renderDrawer('draft');
    expect(screen.queryByRole('button', { name: 'Рассчитать, кого не хватает' })).toBeNull();
  });
});

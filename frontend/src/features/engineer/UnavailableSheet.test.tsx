import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getMyDay, postAction } from '@/api/engineer';
import { ApiError } from '@/api/errors';
import type { EngineerMeDay } from '@/api/types';
import { dayRaw, renderEngineer, visitRaw } from '@/test/engineer';
import EngineerApp from './EngineerApp';

const flags = vi.hoisted(() => ({
  dayClock: false,
  failOther: false,
  engineerIncident: false,
  unavailableBeforeShift: false,
  emergencyByRegion: false,
  cancelComment: false,
  addEngineerAfterPublish: false,
}));

vi.mock('@/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config')>()),
  FEATURES: flags,
}));
vi.mock('@/api/engineer', () => ({
  getMyDay: vi.fn(),
  getMyRoute: vi.fn(),
  postAction: vi.fn(),
}));
vi.mock('@/lib/notify', () => ({ notify: vi.fn() }));

type ActionResult = Awaited<ReturnType<typeof postAction>>;
const ok = (action: string) =>
  ({ engineer_id: 'E01', action, status: 'ok' }) as unknown as ActionResult;

/** На смене: №…1402 в пути, часы дня 14:32, смена до 16:00. */
function onShift(extra: Partial<EngineerMeDay> = {}) {
  const day = dayRaw([visitRaw('305871402', 4, 'en_route'), visitRaw('305866318', 5, 'planned')], {
    active_request_id: '305871402',
    clock: '14:32',
    ...extra,
  });
  day.engineer.shift_end = '16:00';
  return day;
}

const renderApp = (url = '/engineer') => renderEngineer({ home: <EngineerApp /> }, url);

async function fromMenu(item: string) {
  await screen.findByText('А. Мельников'); // день загружен — пункты меню по смене
  fireEvent.click(screen.getByRole('button', { name: 'Меню' }));
  fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: item }));
}

beforeEach(() => {
  Object.assign(flags, { engineerIncident: false, unavailableBeforeShift: false });
  vi.mocked(getMyDay).mockReset();
  vi.mocked(postAction).mockReset();
  vi.mocked(postAction).mockImplementation(async (body) => ok(body.action));
});

describe('E-08 «Не могу работать»', () => {
  it('из меню ⋯: «Сейчас · {часы дня}», без причины → unavailable {from: now}', async () => {
    vi.mocked(getMyDay).mockResolvedValue(onShift());
    renderApp();
    await fromMenu('Не могу работать');

    const sheet = await screen.findByRole('dialog', { name: 'Не могу работать' });
    expect(within(sheet).getByText('Причина — необязательно')).toBeInTheDocument();
    const from = within(sheet).getByLabelText('С какого времени');
    expect(from).toHaveDisplayValue('Сейчас · 14:32');
    expect(
      within(from)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Сейчас · 14:32', '14:45', '15:00', '15:15', '15:30', '15:45']);
    expect(within(sheet).getByRole('radio', { name: 'Без причины' })).toBeChecked();
    expect(
      within(sheet).getByText(
        'Текущую заявку доделайте. Остальные передадут другим инженерам после решения диспетчера',
      ),
    ).toBeInTheDocument();

    fireEvent.click(within(sheet).getByRole('button', { name: 'Сообщить' }));
    await waitFor(() =>
      expect(postAction).toHaveBeenCalledWith({ action: 'unavailable', payload: { from: 'now' } }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('время и причина — в payload', async () => {
    vi.mocked(getMyDay).mockResolvedValue(onShift());
    renderApp('/engineer?sheet=unavailable');
    const sheet = await screen.findByRole('dialog', { name: 'Не могу работать' });
    fireEvent.change(within(sheet).getByLabelText('С какого времени'), {
      target: { value: '15:00' },
    });
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Плохое самочувствие' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Сообщить' }));
    await waitFor(() =>
      expect(postAction).toHaveBeenCalledWith({
        action: 'unavailable',
        payload: { from: '15:00', reason: 'sick' },
      }),
    );
  });

  it('«Не выйду сегодня» — только по флагу; без поля времени', async () => {
    const beforeShift = dayRaw([visitRaw('305871402', 1, 'planned')], {
      shift_status: 'not_started',
    });
    vi.mocked(getMyDay).mockResolvedValue(beforeShift);
    const first = renderApp();
    await screen.findByRole('button', { name: 'Начать смену' });
    expect(screen.queryByRole('button', { name: 'Не выйду сегодня' })).toBeNull();
    first.unmount();

    flags.unavailableBeforeShift = true;
    renderApp();
    fireEvent.click(await screen.findByRole('button', { name: 'Не выйду сегодня' }));
    const sheet = await screen.findByRole('dialog', { name: 'Не выйду сегодня' });
    expect(within(sheet).queryByLabelText('С какого времени')).toBeNull();
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Семейные обстоятельства' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Сообщить' }));
    await waitFor(() =>
      expect(postAction).toHaveBeenCalledWith({
        action: 'unavailable',
        payload: { from: 'now', reason: 'family' },
      }),
    );
  });
});

describe('E-07 «Инцидент» (⏳ engineerIncident)', () => {
  it('по флагу — «Инцидент» рядом с «Прервать»; сломался транспорт → новый транспорт', async () => {
    flags.engineerIncident = true;
    vi.mocked(getMyDay).mockResolvedValue(onShift());
    renderApp();

    fireEvent.click(await screen.findByRole('button', { name: 'Инцидент' }));
    expect(screen.getByRole('button', { name: 'Прервать' })).toBeInTheDocument();
    const sheet = await screen.findByRole('dialog', { name: 'Инцидент' });
    expect(within(sheet).getByText('№305871402 · в пути')).toBeInTheDocument();
    expect(within(sheet).getByRole('radio', { name: 'Сломался транспорт' })).toBeChecked();

    const transport = within(sheet).getByLabelText('Выберите новый транспорт');
    expect(
      within(transport)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Общественный транспорт', 'Пешком', 'Велосипед']);
    fireEvent.change(transport, { target: { value: 'bike' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Сообщить диспетчеру' }));
    await waitFor(() =>
      expect(postAction).toHaveBeenCalledWith({
        action: 'incident',
        request_id: '305871402',
        payload: { reason: 'transport_broken', new_transport: 'bike' },
      }),
    );
  });

  it('не могу продолжить; «Другое» — текст обязателен', async () => {
    flags.engineerIncident = true;
    vi.mocked(getMyDay).mockResolvedValue(onShift());
    vi.mocked(postAction)
      .mockRejectedValueOnce(new ApiError(422, 'COMMENT_REQUIRED', 'Опишите инцидент'))
      .mockImplementation(async (body) => ok(body.action));
    renderApp('/engineer?sheet=incident');
    const sheet = await screen.findByRole('dialog', { name: 'Инцидент' });

    fireEvent.click(within(sheet).getByRole('radio', { name: 'Другое' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Сообщить диспетчеру' }));
    expect(await within(sheet).findByText('Обязательное поле')).toBeInTheDocument();
    expect(postAction).not.toHaveBeenCalled();

    fireEvent.change(within(sheet).getByLabelText('Опишите причину'), {
      target: { value: 'Пробило колесо' },
    });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Сообщить диспетчеру' }));
    expect(await within(sheet).findByText('Опишите инцидент')).toBeInTheDocument();

    fireEvent.click(within(sheet).getByRole('radio', { name: 'Не могу продолжить работу' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Сообщить диспетчеру' }));
    await waitFor(() =>
      expect(postAction).toHaveBeenLastCalledWith({
        action: 'incident',
        request_id: '305871402',
        payload: { reason: 'cannot_continue' },
      }),
    );
  });

  it('без флага шторка не открывается даже по адресу', async () => {
    vi.mocked(getMyDay).mockResolvedValue(onShift());
    renderApp('/engineer?sheet=incident');
    await screen.findByText('ТЕКУЩАЯ · 4 ИЗ 2');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Инцидент' })).toBeNull();
  });
});

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMyDay, getMyRoute, postAction } from '@/api/engineer';
import { ApiError } from '@/api/errors';
import type { EngineerMeDay } from '@/api/types';
import { notify } from '@/lib/notify';
import { dayRaw, renderEngineer, visitRaw } from '@/test/engineer';
import { hideDoneToast } from './doneToastStore';
import EngineerApp from './EngineerApp';

vi.mock('@/api/engineer', () => ({
  getMyDay: vi.fn(),
  getMyRoute: vi.fn(),
  postAction: vi.fn(),
}));
vi.mock('@/lib/notify', () => ({ notify: vi.fn() }));

// флаг «Инцидент» (8.4) переключаем по тестам
const flags = vi.hoisted(() => ({ engineerIncident: false }));
vi.mock('@/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config')>();
  return {
    ...actual,
    FEATURES: {
      ...actual.FEATURES,
      get engineerIncident() {
        return flags.engineerIncident;
      },
    },
  };
});

const renderApp = (url = '/engineer') => renderEngineer({ home: <EngineerApp /> }, url);

beforeEach(() => {
  vi.mocked(getMyDay).mockReset();
  vi.mocked(getMyRoute).mockReset();
  vi.mocked(postAction).mockReset();
  vi.mocked(notify).mockClear();
});

afterEach(() => {
  act(() => hideDoneToast());
});

async function openMenu() {
  fireEvent.click(await screen.findByRole('button', { name: 'Меню' }));
  return screen.getByRole('menu');
}

describe('EngineerApp: состояния страницы (§9.1)', () => {
  it('загрузка — скелетоны, в шапке имя из профиля', () => {
    vi.mocked(getMyDay).mockReturnValue(new Promise(() => {}));
    renderApp();
    expect(screen.getByLabelText('Загрузка')).toBeInTheDocument();
    expect(screen.getByText('Инженер из профиля')).toBeInTheDocument();
  });

  it('ошибка сети — «Повторить» перезапрашивает день', async () => {
    vi.mocked(getMyDay).mockRejectedValueOnce(
      new ApiError(0, 'NETWORK', 'Не удалось связаться с сервером. Повторите'),
    );
    renderApp();
    expect(await screen.findByText('Не удалось связаться с сервером')).toBeInTheDocument();
    vi.mocked(getMyDay).mockResolvedValueOnce(dayRaw([]));
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('На сегодня заявок нет')).toBeInTheDocument();
    expect(getMyDay).toHaveBeenCalledTimes(2);
  });

  it('план не опубликован', async () => {
    vi.mocked(getMyDay).mockResolvedValue(
      dayRaw([visitRaw('A', 1, 'planned')], { plan_published: false }),
    );
    renderApp();
    expect(await screen.findByText('План на сегодня ещё не опубликован')).toBeInTheDocument();
    expect(
      screen.getByText('Он появится, когда диспетчер начнёт рабочий день'),
    ).toBeInTheDocument();
  });

  it('заявок нет', async () => {
    vi.mocked(getMyDay).mockResolvedValue(dayRaw([]));
    renderApp();
    expect(await screen.findByText('На сегодня заявок нет')).toBeInTheDocument();
  });

  it('в шапке — имя инженера из дня', async () => {
    vi.mocked(getMyDay).mockResolvedValue(dayRaw([]));
    renderApp();
    expect(await screen.findByText('А. Мельников')).toBeInTheDocument();
  });
});

describe('меню ⋯ (D-31)', () => {
  it('на смене: «Не могу работать», «Завершить смену», «Выйти»', async () => {
    vi.mocked(getMyDay).mockResolvedValue(dayRaw([visitRaw('A', 1, 'planned')]));
    renderApp();
    await screen.findByText('А. Мельников');
    const menu = await openMenu();
    const items = within(menu)
      .getAllByRole('menuitem')
      .map((item) => item.textContent);
    expect(items).toEqual(['Не могу работать', 'Завершить смену', 'Выйти']);
  });

  it('до смены — только «Выйти»', async () => {
    vi.mocked(getMyDay).mockResolvedValue(
      dayRaw([visitRaw('A', 1, 'planned')], { shift_status: 'not_started' }),
    );
    renderApp();
    await screen.findByText('А. Мельников');
    const menu = await openMenu();
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Выйти']);
  });

  it('заявка в пути — «Завершить смену» объясняет, что сначала закрыть текущую, shift_end не шлёт', async () => {
    vi.mocked(getMyDay).mockResolvedValue(
      dayRaw([visitRaw('A', 1, 'en_route'), visitRaw('B', 2, 'planned')], {
        active_request_id: 'A',
      }),
    );
    renderApp();
    await screen.findByText('А. Мельников');
    const menu = await openMenu();
    const item = within(menu).getByRole('menuitem', { name: 'Завершить смену' });
    expect(item).toBeEnabled();
    fireEvent.click(item);
    const sheet = await screen.findByRole('dialog', { name: 'Завершить смену пока нельзя' });
    expect(within(sheet).getByText(/Сначала закройте текущую заявку/)).toBeInTheDocument();
    expect(within(sheet).getByText(/Осталась 1 заявка/)).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'К текущей заявке' })).toBeInTheDocument();
    expect(postAction).not.toHaveBeenCalled();
  });

  it('«Выйти» — выход из учётной записи', async () => {
    vi.mocked(getMyDay).mockResolvedValue(dayRaw([]));
    const { auth } = renderApp();
    await screen.findByText('А. Мельников');
    const menu = await openMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Выйти' }));
    await waitFor(() => expect(auth.logout).toHaveBeenCalled());
  });
});

type ActionResult = Awaited<ReturnType<typeof postAction>>;

const response = (action: string, day?: EngineerMeDay) =>
  ({ engineer_id: 'E01', action, status: 'ok', day }) as unknown as ActionResult;

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Бэк в памяти: действия меняют статус визита и возвращают день, как POST /engineers/me/actions. */
function fakeServer(initial: EngineerMeDay) {
  let day = clone(initial);
  const next: Record<string, string> = {
    en_route: 'en_route',
    start: 'in_progress',
    complete: 'done',
  };
  vi.mocked(getMyDay).mockImplementation(async () => clone(day));
  vi.mocked(postAction).mockImplementation(async (body) => {
    const status = next[body.action];
    if (status) {
      day = {
        ...day,
        active_request_id: status === 'done' ? null : (body.request_id ?? null),
        visits: (day.visits ?? []).map((visit) =>
          visit.request_id === body.request_id
            ? {
                ...visit,
                status,
                ...(status === 'done' ? { actual_start: '14:10', actual_end: '15:18' } : {}),
              }
            : visit,
        ),
      };
    }
    return response(body.action, clone(day));
  });
}

const enabledButton = async (name: string) => {
  const button = await screen.findByRole('button', { name });
  await waitFor(() => expect(button).toBeEnabled());
  return button;
};

describe('E-03 «Мои заявки»', () => {
  it('цепочка статусов: в путь → в работу → выполнить; тост и следующая заявка', async () => {
    fakeServer(
      dayRaw([visitRaw('305871402', 4, 'planned'), visitRaw('305866318', 5, 'planned')], {
        summary: { total: 9 },
      }),
    );
    renderApp();

    expect(await screen.findByText('ТЕКУЩАЯ · 4 ИЗ 9')).toBeInTheDocument();
    expect(screen.getByText('№305871402')).toBeInTheDocument();
    expect(screen.getByText('окно 14:00–16:00')).toBeInTheDocument();
    expect(screen.getByText('приезд ≈ 13:30')).toBeInTheDocument();

    const sent = (body: object) => waitFor(() => expect(postAction).toHaveBeenLastCalledWith(body));

    fireEvent.click(await enabledButton('Отправиться в путь'));
    await sent({ action: 'en_route', request_id: '305871402' });

    fireEvent.click(await enabledButton('Взять в работу'));
    await sent({ action: 'start', request_id: '305871402' });
    expect(screen.getByText('начало 13:40')).toBeInTheDocument();

    fireEvent.click(await enabledButton('Выполнить задачу'));
    await sent({ action: 'complete', request_id: '305871402' });

    expect(await screen.findByText('Заявка №…1402 выполнена')).toBeInTheDocument();
    expect(
      screen.getByText('14:10–15:18 · следующая — ул.Окская, д. 5, 1,6 км'),
    ).toBeInTheDocument();
    expect(await screen.findByText('ТЕКУЩАЯ · 5 ИЗ 9')).toBeInTheDocument();
    expect(await enabledButton('Отправиться в путь')).toBeInTheDocument();
  });

  it('409 — статус откатывается, тост с сообщением бэка', async () => {
    vi.mocked(getMyDay).mockResolvedValue(dayRaw([visitRaw('A', 1, 'planned')]));
    vi.mocked(postAction).mockRejectedValue(
      new ApiError(409, 'ILLEGAL_TRANSITION', 'Сначала начните смену'),
    );
    renderApp();

    fireEvent.click(await enabledButton('Отправиться в путь'));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Сначала начните смену', 'error'));
    expect(await enabledButton('Отправиться в путь')).toBeInTheDocument();
    expect(screen.getByText('Запланирована')).toBeInTheDocument();
  });

  it('без действия incident в API — «Прервать» на всю ширину, «Инцидента» нет', async () => {
    flags.engineerIncident = false;
    vi.mocked(getMyDay).mockResolvedValue(dayRaw([visitRaw('A', 1, 'en_route')]));
    renderApp();
    expect(await screen.findByRole('button', { name: 'Прервать' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Инцидент' })).toBeNull();
  });

  it('действие incident есть (флаг engineerIncident) — «Инцидент» рядом с «Прервать»', async () => {
    flags.engineerIncident = true;
    vi.mocked(getMyDay).mockResolvedValue(dayRaw([visitRaw('A', 1, 'en_route')]));
    renderApp();
    expect(await screen.findByRole('button', { name: 'Инцидент' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Прервать' })).toBeInTheDocument();
    flags.engineerIncident = false;
  });

  it('«Далее»: сначала ждущие решения, затем запланированные по порядку; флаги', async () => {
    vi.mocked(getMyDay).mockResolvedValue(
      dayRaw(
        [
          visitRaw('1001', 1, 'done'),
          visitRaw('1002', 2, 'cancel_pending'),
          visitRaw('1003', 3, 'in_progress'),
          visitRaw('1005', 5, 'planned', { flags: ['urgent'] }),
          visitRaw('1004', 4, 'planned', { flags: ['changed', 'at_risk'] }),
        ],
        { active_request_id: '1003' },
      ),
    );
    renderApp();

    const next = await screen.findByRole('region', { name: 'Далее по маршруту' });
    const rows = within(next).getAllByRole('link');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('Ждёт решения диспетчера');
    expect(within(rows[0]).getByText('Отменяется')).toBeInTheDocument();
    expect(rows[0]).toHaveAttribute('href', '/engineer/request/1002');
    expect(rows[1]).toHaveTextContent('13:30ул.Окская, д. 4');
    expect(rows[1]).toHaveTextContent('Заявка 4 · окно 14–16');
    expect(within(rows[1]).getByText('Изменено')).toBeInTheDocument();
    expect(within(rows[1]).getByRole('img', { name: 'Под угрозой' })).toBeInTheDocument();
    expect(within(rows[2]).getByText('Срочная')).toBeInTheDocument();
  });

  it('«Завершённые · N» свёрнуты, по нажатию — строки', async () => {
    vi.mocked(getMyDay).mockResolvedValue(
      dayRaw([
        visitRaw('1001', 1, 'done'),
        visitRaw('1002', 2, 'cancelled'),
        visitRaw('1003', 3, 'planned'),
      ]),
    );
    renderApp();
    const toggle = await screen.findByRole('button', { name: 'Завершённые · 2' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('img', { name: 'Выполнена' })).toBeNull();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('img', { name: 'Выполнена' })).toBeInTheDocument();
    expect(screen.getByText('Отменена')).toBeInTheDocument();
  });

  it('все заявки закрыты — «Завершить смену» сразу, если запланированных нет', async () => {
    vi.mocked(getMyDay).mockResolvedValue(
      dayRaw([visitRaw('A', 1, 'done'), visitRaw('B', 2, 'reschedule_pending')]),
    );
    vi.mocked(postAction).mockResolvedValue(response('shift_end'));
    renderApp();
    expect(await screen.findByText('Все заявки на сегодня закрыты')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Завершить смену' }));
    await waitFor(() => expect(postAction).toHaveBeenCalledWith({ action: 'shift_end' }));
  });

  it('«Не могу работать» принят: кнопок нет, заявку в работе можно выполнить', async () => {
    vi.mocked(getMyDay).mockResolvedValue(
      dayRaw([visitRaw('A', 1, 'in_progress'), visitRaw('B', 2, 'planned')], {
        shift_status: 'unavailable',
        active_request_id: 'A',
      }),
    );
    renderApp();
    expect(await screen.findByRole('button', { name: 'Выполнить задачу' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Прервать' })).toBeNull();
  });

  it('«Не могу работать» принят, заявка в пути — без кнопок', async () => {
    vi.mocked(getMyDay).mockResolvedValue(
      dayRaw([visitRaw('A', 1, 'en_route')], { shift_status: 'unavailable' }),
    );
    renderApp();
    expect(await screen.findByText('ТЕКУЩАЯ · 1 ИЗ 1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Взять в работу' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Прервать' })).toBeNull();
  });
});

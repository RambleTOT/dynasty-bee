import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getMyDay, postAction } from '@/api/engineer';
import type { EngineerMeDay } from '@/api/types';
import { dayRaw, renderEngineer, visitRaw } from '@/test/engineer';
import EngineerApp from './EngineerApp';

vi.mock('@/api/engineer', () => ({
  getMyDay: vi.fn(),
  getMyRoute: vi.fn(),
  postAction: vi.fn(),
}));
vi.mock('@/lib/notify', () => ({ notify: vi.fn() }));

type ActionResult = Awaited<ReturnType<typeof postAction>>;

const finished = (extra: Partial<EngineerMeDay> = {}) =>
  dayRaw([visitRaw('A', 1, 'done'), visitRaw('B', 2, 'done'), visitRaw('C', 3, 'cancel_pending')], {
    shift_status: 'finished',
    ...extra,
  });

/** Плитки «подпись → значение». */
function tiles() {
  return Object.fromEntries(
    screen
      .getAllByRole('term')
      .map((term) => [term.textContent, term.nextElementSibling?.textContent]),
  );
}

beforeEach(() => {
  vi.mocked(getMyDay).mockReset();
  vi.mocked(postAction).mockReset();
  vi.mocked(postAction).mockImplementation(
    async (body) => ({ engineer_id: 'E01', action: body.action, status: 'ok' }) as ActionResult,
  );
});

describe('E-10 «Итоги смены»', () => {
  it('по shift_totals: цифры и факт начала и конца смены', async () => {
    vi.mocked(getMyDay).mockResolvedValue(
      finished({
        shift_totals: {
          done: 6,
          total: 7,
          started_in_window: 6,
          km: 28.4,
          minutes_travel: 130,
          minutes_work: 340,
          minutes_wait: 35,
          interrupted: 1,
          started_at: '10:00',
          ended_at: '21:35',
        },
      }),
    );
    renderEngineer({ home: <EngineerApp /> });
    expect(await screen.findByRole('heading', { name: 'Смена завершена' })).toBeInTheDocument();
    expect(screen.getByText('Вт, 29 сентября · 10:00–21:35')).toBeInTheDocument();
    expect(tiles()).toEqual({
      Выполнено: '6 из 7',
      'Начато в окне': '6 из 6',
      Пробег: '28,4 км',
      Прервано: '1',
      'В дороге': '2 ч 10 мин',
      'В работе': '5 ч 40 мин',
      'В ожидании': '35 мин',
    });
  });

  it('нули из shift_totals показываем как есть', async () => {
    vi.mocked(getMyDay).mockResolvedValue(
      finished({
        shift_totals: {
          done: 2,
          total: 3,
          started_in_window: 2,
          km: 12,
          minutes_travel: 50,
          minutes_work: 0,
          minutes_wait: 0,
          interrupted: 1,
        },
      }),
    );
    renderEngineer({ home: <EngineerApp /> });
    await screen.findByRole('heading', { name: 'Смена завершена' });
    expect(screen.getByText('Вт, 29 сентября · смена 10:00–22:00')).toBeInTheDocument();
    expect(tiles()).toMatchObject({ 'В работе': '0 мин', 'В ожидании': '0 мин' });
  });

  it('без shift_totals — «Выполнено» и «Прервано» по визитам, остальное «—»', async () => {
    vi.mocked(getMyDay).mockResolvedValue(finished());
    renderEngineer({ home: <EngineerApp /> });
    await screen.findByRole('heading', { name: 'Смена завершена' });
    expect(tiles()).toEqual({
      Выполнено: '2 из 3',
      'Начато в окне': '—',
      Пробег: '—',
      Прервано: '1',
      'В дороге': '—',
      'В работе': '—',
      'В ожидании': '—',
    });
  });

  it('«Выйти» — secondary внизу', async () => {
    vi.mocked(getMyDay).mockResolvedValue(finished());
    const { auth } = renderEngineer({ home: <EngineerApp /> });
    fireEvent.click(await screen.findByRole('button', { name: 'Выйти' }));
    await waitFor(() => expect(auth.logout).toHaveBeenCalled());
  });
});

describe('«Завершить смену»', () => {
  const onShift = (visits = [visitRaw('A', 1, 'done'), visitRaw('B', 2, 'planned')]) =>
    dayRaw([...visits, visitRaw('C', 3, 'planned')]);

  async function fromMenu() {
    await screen.findByText('А. Мельников');
    fireEvent.click(screen.getByRole('button', { name: 'Меню' }));
    fireEvent.click(
      within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Завершить смену' }),
    );
  }

  it('остались запланированные — подтверждение «Осталось N заявок…» → shift_end', async () => {
    vi.mocked(getMyDay).mockResolvedValue(onShift());
    renderEngineer({ home: <EngineerApp /> });
    await fromMenu();

    const sheet = await screen.findByRole('dialog', { name: 'Завершить смену' });
    expect(
      within(sheet).getByText('Осталось 2 заявки. Они вернутся диспетчеру'),
    ).toBeInTheDocument();
    expect(postAction).not.toHaveBeenCalled();

    fireEvent.click(within(sheet).getByRole('button', { name: 'Завершить смену' }));
    await waitFor(() => expect(postAction).toHaveBeenCalledWith({ action: 'shift_end' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('«Отмена» — без действия', async () => {
    vi.mocked(getMyDay).mockResolvedValue(onShift());
    renderEngineer({ home: <EngineerApp /> });
    await fromMenu();
    const sheet = await screen.findByRole('dialog', { name: 'Завершить смену' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(postAction).not.toHaveBeenCalled();
  });

  it('запланированных нет — сразу shift_end', async () => {
    vi.mocked(getMyDay).mockResolvedValue(
      dayRaw([visitRaw('A', 1, 'done'), visitRaw('B', 2, 'cancel_pending')]),
    );
    renderEngineer({ home: <EngineerApp /> });
    await fromMenu();
    await waitFor(() => expect(postAction).toHaveBeenCalledWith({ action: 'shift_end' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

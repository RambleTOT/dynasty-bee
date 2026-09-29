import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCalendar } from '@/api/calendar';
import { getRegions } from '@/api/data';
import { ApiError } from '@/api/errors';
import type { CalendarResponse, RegionInfo, UserOut } from '@/api/types';
import { AuthContext, type AuthContextValue } from '@/auth/useAuth';
import CalendarPage from './CalendarPage';

vi.mock('@/api/calendar', () => ({ getCalendar: vi.fn() }));
vi.mock('@/api/data', () => ({ getRegions: vi.fn(), importBeeline: vi.fn() }));

const region = (region_id: string, name: string, engineer_count: number): RegionInfo => ({
  region_id,
  name,
  office: { address: 'г. Москва', lat: 55.7, lon: 37.6 },
  request_count: 0,
  engineer_count,
  demo_available: false,
  has_control: false,
});

const REGIONS_RESPONSE = [
  region('east', 'Восток', 12),
  region('south_east', 'Юго-восток', 12),
  region('south_center', 'Югоцентр', 11),
];

const SEPTEMBER: CalendarResponse = {
  days: [
    {
      date: '2026-09-29',
      request_count: 66,
      by_status: {
        done: 14,
        en_route: 2,
        in_progress: 4,
        planned: 42,
        cancel_pending: 1,
        unassigned: 3,
      },
      flags: { urgent: 1, late: 1 },
      sources: ['csv'],
    },
    {
      date: '2026-09-10',
      request_count: 20,
      by_status: { done: 20 },
      flags: { urgent: 0 },
      sources: ['booking'],
    },
  ],
};

/** «Все регионы» — запрос по каждому региону: заявки сентября — у Востока, у остальных пусто. */
const byRegion = async ({ region_id }: { region_id?: string }): Promise<CalendarResponse> =>
  region_id === 'east' || region_id === 'all' ? SEPTEMBER : { days: [] };

function CurrentUrl() {
  const { pathname, search } = useLocation();
  return <output data-testid="url">{decodeURIComponent(pathname + search)}</output>;
}

function renderCalendar(url: string, regionIds: string[] = ['east', 'south_east', 'south_center']) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const user: UserOut = {
    id: 'u1',
    login: 'dispatcher',
    name: 'Диспетчер',
    role: 'dispatcher',
    region_ids: regionIds,
  };
  const auth: AuthContextValue = {
    user,
    role: 'dispatcher',
    status: 'authenticated',
    login: vi.fn(),
    logout: vi.fn(),
  };
  render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter
          initialEntries={[url]}
          future={{ v7_startTransition: false, v7_relativeSplatPath: true }}
        >
          <Routes>
            <Route path="/dispatcher" element={<CalendarPage />} />
            <Route path="/dispatcher/day/:date" element={<p>DS-03</p>} />
          </Routes>
          <CurrentUrl />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
  return client;
}

const url = () => screen.getByTestId('url').textContent;
const dayLink = (count: RegExp) => screen.findByRole('link', { name: count });

beforeEach(() => {
  // «Сегодня» — 29.09.2026 по Москве; таймеры настоящие, подменяем только дату.
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-09-29T09:00:00Z'));
  vi.mocked(getCalendar).mockReset().mockImplementation(byRegion);
  vi.mocked(getRegions).mockReset().mockResolvedValue(REGIONS_RESPONSE);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('DS-01 Календарь заявок', () => {
  it('текущий месяц по умолчанию: запрос на всю сетку, итог, ячейки', async () => {
    renderCalendar('/dispatcher');
    expect(screen.getByRole('heading', { name: 'Календарь заявок' })).toBeInTheDocument();
    expect(screen.getByText('Сентябрь 2026')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Загрузка календаря' })).toBeInTheDocument();

    expect(await screen.findByText('86 заявок за месяц · 3 региона')).toBeInTheDocument();
    // «Все регионы» — по запросу на регион: в подсказке видно, где неназначенные
    for (const region_id of ['east', 'south_east', 'south_center']) {
      expect(getCalendar).toHaveBeenCalledWith(
        { from: '2026-08-31', to: '2026-10-04', region_id, status: undefined, type_bk: undefined },
        expect.anything(),
      );
    }
    expect(getCalendar).not.toHaveBeenCalledWith(
      expect.objectContaining({ region_id: 'all' }),
      expect.anything(),
    );

    const today = await dayLink(/66 заявок/);
    expect(today).toHaveAttribute('href', '/dispatcher/day/2026-09-29?region=east');
    for (const text of ['29', 'CSV', 'СЕГОДНЯ', '3 не назначены', '1 просрочена']) {
      expect(within(today).getByText(text)).toBeInTheDocument();
    }
    const past = await dayLink(/20 заявок/);
    expect(within(past).queryByText('CSV')).not.toBeInTheDocument();
    expect(within(past).queryByText(/просрочен/)).not.toBeInTheDocument();
    // пустые дни — «—»
    expect(screen.getAllByText('—').length).toBeGreaterThan(20);
  });

  it('легенда — только встречающиеся статусы', async () => {
    renderCalendar('/dispatcher');
    const legend = await screen.findByRole('list', { name: 'Статусы в полосе' });
    expect(
      within(legend)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Выполнена', 'В работе', 'В пути', 'Запланирована', 'Отменяется', 'Не назначена']);
  });

  it('подсказка по наведению: строка на каждый статус и флаг «Просрочена»', async () => {
    renderCalendar('/dispatcher');
    const today = await dayLink(/66 заявок/);
    fireEvent.mouseEnter(today.parentElement as HTMLElement);
    const tip = screen.getByRole('tooltip');
    expect(within(tip).getByText('Вт, 29 сентября · 66 заявок')).toBeInTheDocument();
    expect(within(tip).getByText('В пути')).toBeInTheDocument();
    expect(within(tip).getByText('В работе')).toBeInTheDocument();
    expect(within(tip).getByText('Флаг «Просрочена»')).toBeInTheDocument();
    // по регионам: только регионы с заявками в этот день
    expect(within(tip).getByText('По регионам')).toBeInTheDocument();
    expect(within(tip).getByText('Восток')).toBeInTheDocument();
    expect(within(tip).getByText('· 3 не назн.', { exact: false })).toBeInTheDocument();
    expect(within(tip).queryByText('Югоцентр')).not.toBeInTheDocument();
    expect(today).toHaveAttribute('aria-describedby', tip.id);
    fireEvent.mouseLeave(today.parentElement as HTMLElement);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('клик по дню: регион фильтра, а из «Все регионы» — первый регион пользователя', async () => {
    renderCalendar('/dispatcher', ['south_east', 'east']);
    fireEvent.click(await dayLink(/66 заявок/));
    expect(url()).toBe('/dispatcher/day/2026-09-29?region=south_east');
  });

  it('фильтр региона — в запросе, итоге и ссылке на день', async () => {
    vi.mocked(getCalendar).mockResolvedValue(SEPTEMBER);
    renderCalendar('/dispatcher?month=2026-09&region=south_center');
    expect(await screen.findByText('86 заявок за месяц · 1 регион')).toBeInTheDocument();
    expect(getCalendar).toHaveBeenCalledWith(
      expect.objectContaining({ region_id: 'south_center' }),
      expect.anything(),
    );
    expect(await dayLink(/66 заявок/)).toHaveAttribute(
      'href',
      '/dispatcher/day/2026-09-29?region=south_center',
    );
  });

  it('фильтры «Статус» и «Тип заявки» — по одному значению, в адресе; «Сбросить»', async () => {
    renderCalendar('/dispatcher');
    await dayLink(/66 заявок/);

    fireEvent.click(screen.getByRole('button', { name: 'Статус' }));
    fireEvent.click(screen.getByRole('option', { name: 'Выполнена' }));
    expect(url()).toBe('/dispatcher?status=done');
    await waitFor(() =>
      expect(getCalendar).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'done', type_bk: undefined }),
        expect.anything(),
      ),
    );
    expect(screen.getByRole('button', { name: 'Статус · Выполнена' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Тип заявки' }));
    fireEvent.click(screen.getByRole('option', { name: 'Подключение' }));
    expect(url()).toBe('/dispatcher?status=done&type=connection');
    await waitFor(() =>
      expect(getCalendar).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'done', type_bk: 'Подключение' }),
        expect.anything(),
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Сбросить' }));
    expect(url()).toBe('/dispatcher');
    expect(screen.getByRole('button', { name: 'Сбросить' })).toBeDisabled();
  });

  it('переключатель месяца и «Сегодня»', async () => {
    renderCalendar('/dispatcher');
    fireEvent.click(screen.getByRole('button', { name: 'Следующий месяц' }));
    expect(url()).toBe('/dispatcher?month=2026-10');
    expect(screen.getByText('Октябрь 2026')).toBeInTheDocument();
    await waitFor(() =>
      expect(getCalendar).toHaveBeenLastCalledWith(
        expect.objectContaining({ from: '2026-09-28', to: '2026-11-01' }),
        expect.anything(),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Сегодня' }));
    expect(url()).toBe('/dispatcher');
    expect(screen.getByText('Сентябрь 2026')).toBeInTheDocument();
  });

  it('пустой месяц', async () => {
    vi.mocked(getCalendar).mockResolvedValue({ days: [] });
    renderCalendar('/dispatcher?month=2026-11');
    expect(await screen.findByText('В этом месяце заявок нет')).toBeInTheDocument();
    expect(screen.getByText('Загрузите CSV или дождитесь записей оператора')).toBeInTheDocument();
    expect(screen.getByText('0 заявок за месяц · 3 региона')).toBeInTheDocument();
  });

  it('ошибка сети — «Повторить»', async () => {
    vi.mocked(getCalendar)
      .mockRejectedValueOnce(
        new ApiError(0, 'NETWORK', 'Не удалось связаться с сервером. Повторите'),
      )
      .mockImplementation(byRegion);
    renderCalendar('/dispatcher');
    expect(await screen.findByText('Не удалось связаться с сервером')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await dayLink(/66 заявок/)).toBeInTheDocument();
  });

  it('фильтр по статусу: в ячейке — только заявки с этим статусом', async () => {
    vi.mocked(getCalendar).mockResolvedValue({
      days: [
        { date: '2026-09-29', request_count: 66, by_status: { en_route: 2 }, flags: {}, sources: [] },
      ],
    });
    renderCalendar('/dispatcher?region=east&status=en_route');
    expect(await dayLink(/2 заявки/)).toBeInTheDocument();
    expect(screen.queryByText('66 заявок')).not.toBeInTheDocument();
  });

  it('ошибка бэка — его текст', async () => {
    vi.mocked(getCalendar).mockRejectedValue(new ApiError(500, 'INTERNAL', 'Сервис недоступен'));
    renderCalendar('/dispatcher');
    expect(await screen.findByText('Сервис недоступен')).toBeInTheDocument();
  });

  it('modal=import открывает DS-02, ✕ закрывает', async () => {
    renderCalendar('/dispatcher?modal=import');
    const dialog = await screen.findByRole('dialog', { name: 'Загрузка CSV' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Закрыть' }));
    expect(url()).toBe('/dispatcher');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

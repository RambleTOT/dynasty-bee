import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { searchRequests } from '@/api/booking';
import { RequestSearch } from './RequestSearch';

vi.mock('@/api/booking', () => ({ searchRequests: vi.fn() }));

function Where() {
  const { pathname, search } = useLocation();
  return <output data-testid="url">{decodeURIComponent(pathname + search)}</output>;
}

function renderSearch() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/dispatcher']} future={{ v7_startTransition: false, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="*" element={<RequestSearch />} />
        </Routes>
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.mocked(searchRequests).mockImplementation(async (q: string) =>
    q.startsWith('10197')
      ? [
          { request_id: '10197', region_id: 'east', date: '2026-09-29', window: '12:00-14:00', address: 'ул. Примерная, д. 45', type_bk: 'Подключение', status: 'planned' },
          { request_id: '10197', region_id: 'south_center', date: '2026-09-29', window: '10:00-12:00', address: '', type_bk: 'Подключение', status: 'unassigned' },
        ]
      : [],
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('Поиск заявки по номеру у диспетчера', () => {
  it('номер → заявки по дням и регионам; выбор — день заявки с её карточкой', async () => {
    renderSearch();
    const input = screen.getByRole('combobox', { name: 'Найти заявку по номеру' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '10197' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });
    const options = await screen.findAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      '№10197ЗапланированаВосток · 29.09 · окно 12–14 · ул. Примерная, д. 45',
      '№10197Не назначенаЮгоцентр · 29.09 · окно 10–12',
    ]);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('url')).toHaveTextContent('/dispatcher/day/2026-09-29?region=south_center&pin=10197');
  });

  it('«ВК-…» русскими — ищем и как BK-; ничего — «Заявки с таким номером нет»', async () => {
    renderSearch();
    const input = screen.getByRole('combobox', { name: 'Найти заявку по номеру' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'ВК-20260929' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });
    expect(await screen.findByText('Заявки с таким номером нет')).toBeInTheDocument();
    expect(searchRequests).toHaveBeenCalledWith('BK-20260929', expect.anything());
  });
});

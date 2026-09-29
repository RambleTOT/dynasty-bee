import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRealtimeTicket } from '@/api/realtime';
import type { UserOut } from '@/api/types';
import { isRole } from '@/auth/roles';
import { REALTIME } from '@/config';
import { AuthContext, type AuthContextValue } from '@/auth/useAuth';
import { dismissAll, NotifyProvider } from '@/lib/notify';
import { RealtimeProvider } from './RealtimeProvider';
import { usePollInterval } from './useRealtime';

vi.mock('@/api/realtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/realtime')>()),
  getRealtimeTicket: vi.fn(),
}));

/** Поддельный WebSocket браузера: последний созданный — `FakeWebSocket.last`. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static get last() {
    return FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  }
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }
  send() {}
  close() {
    this.closed = true;
  }
  receive(message: unknown) {
    act(() => this.onmessage?.({ data: JSON.stringify(message) }));
  }
}

const dispatcher: UserOut = {
  id: 'u-1',
  login: 'dispatcher',
  name: 'Диспетчер',
  role: 'dispatcher',
  region_ids: ['east'],
};

const auth = (user: UserOut | null): AuthContextValue => ({
  user,
  role: user && isRole(user.role) ? user.role : null,
  status: user ? 'authenticated' : 'anonymous',
  login: vi.fn(),
  logout: vi.fn(async () => {}),
});

function Probe() {
  const { pathname, search } = useLocation();
  return (
    <>
      <output data-testid="poll">{usePollInterval(10_000)}</output>
      <output data-testid="location">{pathname + search}</output>
    </>
  );
}

function renderProvider(user: UserOut | null = dispatcher, enabled = true) {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const view = render(
    <QueryClientProvider client={client}>
      <NotifyProvider>
        <AuthContext.Provider value={auth(user)}>
          <MemoryRouter
            initialEntries={['/dispatcher']}
            future={{ v7_startTransition: false, v7_relativeSplatPath: true }}
          >
            <Routes>
              <Route
                path="*"
                element={
                  <RealtimeProvider enabled={enabled}>
                    <Probe />
                  </RealtimeProvider>
                }
              />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      </NotifyProvider>
    </QueryClientProvider>,
  );
  return { ...view, invalidate };
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.mocked(getRealtimeTicket).mockReset().mockResolvedValue('ticket-1');
});

afterEach(() => {
  act(() => dismissAll());
  vi.unstubAllGlobals();
});

describe('RealtimeProvider', () => {
  it('флаг выключен или гость — сокета нет, опрос обычный', async () => {
    renderProvider(dispatcher, false);
    renderProvider(null, true);
    await act(async () => {});
    expect(getRealtimeTicket).not.toHaveBeenCalled();
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(screen.getAllByTestId('poll')[0]).toHaveTextContent('10000');
  });

  it('событие → обновление запросов, тост «ждёт решения», «Открыть» ведёт к предложению', async () => {
    const { invalidate, unmount } = renderProvider();
    // сеанс грузится отдельным чанком: под нагрузкой полного прогона секунды бывает мало
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1), { timeout: 5_000 });
    expect(FakeWebSocket.last.url).toMatch(/\/api\/v1\/realtime\/ws\?ticket=ticket-1$/);

    FakeWebSocket.last.receive({ type: 'hello', protocol: 1, seq: 5, resumed: false });
    // сокет открыт: опрос — страховочный (пока бэк шлёт только события плана — не реже обычного)
    expect(screen.getByTestId('poll')).toHaveTextContent(
      String(Math.max(10_000, REALTIME.safetyPollMs)),
    );

    FakeWebSocket.last.receive({
      type: 'event',
      seq: 6,
      kind: 'plan.proposed',
      region_id: 'east',
      date: '2026-09-29',
      actor: { role: 'operator', name: 'Оператор' },
      data: { plan_id: 'P9', event_type: 'order_cancelled', source: 'operator', order_id: '10211' },
    });
    expect(screen.getByText('Оператор отменил №10211 — ждёт решения')).toBeInTheDocument();
    expect(screen.getByText('Восток · 29.09')).toBeInTheDocument();
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['days', '2026-09-29'] }),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['booking', 'search'] });

    fireEvent.click(screen.getByRole('button', { name: 'Открыть' }));
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/dispatcher/day/2026-09-29?region=east&proposal=P9',
    );

    unmount();
    expect(FakeWebSocket.last.closed).toBe(true);
  });
});

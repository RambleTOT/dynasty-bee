import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createBrowserRouter, Outlet, RouterProvider, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authApi } from '@/api/auth';
import { UNAUTHORIZED_EVENT } from '@/api/client';
import { ApiError } from '@/api/errors';
import type { UserOut } from '@/api/types';
import { AuthProvider } from './AuthProvider';
import { tokenStorage } from './tokenStorage';
import { useAuth } from './useAuth';

vi.mock('@/api/auth', () => ({
  authApi: { login: vi.fn(), me: vi.fn(), logout: vi.fn() },
}));

const dispatcher: UserOut = {
  id: 'u1',
  login: 'dispatcher',
  name: 'Диспетчер',
  role: 'dispatcher',
  region_ids: ['east'],
};

function Probe() {
  const { status, user, role, login, logout } = useAuth();
  const { pathname, search } = useLocation();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="user">{user ? `${user.name}/${role}` : '—'}</span>
      <span data-testid="url">{pathname + search}</span>
      <button onClick={() => void login('dispatcher', 'secret').catch(() => undefined)}>
        login
      </button>
      <button onClick={() => void logout()}>logout</button>
    </div>
  );
}

function renderAt(url: string) {
  window.history.replaceState(null, '', url);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createBrowserRouter(
    [
      {
        element: (
          <AuthProvider>
            <Outlet />
          </AuthProvider>
        ),
        children: [{ path: '*', element: <Probe /> }],
      },
    ],
    {
      future: {
        v7_relativeSplatPath: true,
        v7_fetcherPersist: true,
        v7_normalizeFormMethod: true,
        v7_partialHydration: true,
        v7_skipActionErrorRevalidation: true,
      },
    },
  );
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} future={{ v7_startTransition: false }} />
    </QueryClientProvider>,
  );
}

const text = (id: string) => screen.getByTestId(id).textContent;

beforeEach(() => {
  vi.mocked(authApi.login).mockReset();
  vi.mocked(authApi.me).mockReset();
  vi.mocked(authApi.logout).mockReset();
});

describe('AuthProvider', () => {
  it('без токена — гость, профиль не запрашивается', () => {
    renderAt('/login');
    expect(text('status')).toBe('anonymous');
    expect(authApi.me).not.toHaveBeenCalled();
  });

  it('есть токен — профиль из me', async () => {
    tokenStorage.set('t1');
    vi.mocked(authApi.me).mockResolvedValue(dispatcher);
    renderAt('/dispatcher');
    expect(text('status')).toBe('loading');
    await waitFor(() => expect(text('status')).toBe('authenticated'));
    expect(text('user')).toBe('Диспетчер/dispatcher');
  });

  it('вход: токен сохраняется, профиль — из ответа входа без лишнего me', async () => {
    tokenStorage.set('stale');
    vi.mocked(authApi.me).mockRejectedValue(new ApiError(0, 'NETWORK', 'нет сети'));
    vi.mocked(authApi.login).mockImplementation(async () => {
      // старый токен к ручке входа не уходит
      expect(tokenStorage.get()).toBeNull();
      return { access_token: 't2', token_type: 'bearer', user: dispatcher };
    });
    renderAt('/login?next=%2Fdispatcher');
    await waitFor(() => expect(text('status')).toBe('anonymous'));

    fireEvent.click(screen.getByText('login'));
    await waitFor(() => expect(text('status')).toBe('authenticated'));
    expect(tokenStorage.get()).toBe('t2');
    expect(authApi.me).toHaveBeenCalledTimes(1);
  });

  it('сессия истекла на экране → /login?next=… и сброс токена', async () => {
    tokenStorage.set('t1');
    vi.mocked(authApi.me).mockResolvedValue(dispatcher);
    renderAt('/dispatcher/day/2026-09-28?view=timeline');
    await waitFor(() => expect(text('status')).toBe('authenticated'));

    act(() => {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    });
    expect(text('status')).toBe('anonymous');
    expect(tokenStorage.get()).toBeNull();
    expect(text('url')).toBe(
      `/login?next=${encodeURIComponent('/dispatcher/day/2026-09-28?view=timeline')}`,
    );
  });

  it('сессия истекла на странице входа — адрес с next не меняется', async () => {
    tokenStorage.set('t1');
    vi.mocked(authApi.me).mockReturnValue(new Promise(() => undefined));
    renderAt('/login?next=%2Fdispatcher');

    act(() => {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    });
    expect(text('status')).toBe('anonymous');
    expect(text('url')).toBe('/login?next=%2Fdispatcher');
  });

  it('«Выйти» → ручка logout, сброс токена, /login без next', async () => {
    tokenStorage.set('t1');
    vi.mocked(authApi.me).mockResolvedValue(dispatcher);
    vi.mocked(authApi.logout).mockResolvedValue(undefined);
    renderAt('/dispatcher/day/2026-09-28');
    await waitFor(() => expect(text('status')).toBe('authenticated'));

    fireEvent.click(screen.getByText('logout'));
    await waitFor(() => expect(text('url')).toBe('/login'));
    expect(authApi.logout).toHaveBeenCalledTimes(1);
    expect(tokenStorage.get()).toBeNull();
    expect(text('status')).toBe('anonymous');
  });

  it('«Выйти» при ошибке ручки — всё равно выходим', async () => {
    tokenStorage.set('t1');
    vi.mocked(authApi.me).mockResolvedValue(dispatcher);
    vi.mocked(authApi.logout).mockRejectedValue(new ApiError(0, 'NETWORK', 'нет сети'));
    renderAt('/dispatcher');
    await waitFor(() => expect(text('status')).toBe('authenticated'));

    fireEvent.click(screen.getByText('logout'));
    await waitFor(() => expect(text('url')).toBe('/login'));
    expect(tokenStorage.get()).toBeNull();
  });
});

describe('AuthProvider: инженеру /auth/me отвечает 403 (бэк 28.09)', () => {
  it('профиль берём из токена — сессия жива', async () => {
    const claims = { sub: 'u6', login: 'eng-east-06', name: 'Бригада 6', role: 'engineer', region_ids: ['east'], engineer_id: 'E06', exp: 4_000_000_000 };
    const payload = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(claims))))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    tokenStorage.set(`h.${payload}.s`);
    vi.mocked(authApi.me).mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'Недостаточно прав для этой роли'));
    renderAt('/engineer');
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    expect(screen.getByTestId('user')).toHaveTextContent('Бригада 6/engineer');
  });
});

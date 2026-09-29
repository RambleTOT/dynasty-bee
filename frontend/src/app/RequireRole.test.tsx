import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role, UserOut } from '@/api/types';
import { AuthContext, type AuthContextValue } from '@/auth/useAuth';
import { notify } from '@/lib/notify';
import { RequireRole } from './RequireRole';

vi.mock('@/lib/notify', () => ({ notify: vi.fn() }));

function authAs(role: Role | null, status: AuthContextValue['status']): AuthContextValue {
  const user: UserOut | null = role ? { id: 'u1', login: role, name: 'Тест', role } : null;
  return { user, role, status, login: vi.fn(), logout: vi.fn() };
}

function CurrentUrl() {
  const { pathname, search } = useLocation();
  return <span data-testid="url">{pathname + search}</span>;
}

function renderAt(url: string, auth: AuthContextValue) {
  return render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter
        initialEntries={[url]}
        future={{ v7_startTransition: false, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route path="/login" element={<p>S-01</p>} />
          <Route
            path="/dispatcher/*"
            element={
              <RequireRole role="dispatcher">
                <p>DS-01</p>
              </RequireRole>
            }
          />
          <Route path="/engineer" element={<p>E-03</p>} />
          <Route path="/operator" element={<p>O-01</p>} />
        </Routes>
        <CurrentUrl />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

beforeEach(() => {
  vi.mocked(notify).mockClear();
});

describe('RequireRole', () => {
  it('гость → /login с next', () => {
    renderAt('/dispatcher/day/2026-09-28?view=timeline', authAs(null, 'anonymous'));
    expect(screen.getByText('S-01')).toBeInTheDocument();
    expect(screen.getByTestId('url')).toHaveTextContent(
      `/login?next=${encodeURIComponent('/dispatcher/day/2026-09-28?view=timeline')}`,
    );
  });

  it('чужая роль → уведомление и главная своей роли', () => {
    renderAt('/dispatcher', authAs('engineer', 'authenticated'));
    expect(screen.getByText('E-03')).toBeInTheDocument();
    expect(screen.getByTestId('url')).toHaveTextContent('/engineer');
    expect(notify).toHaveBeenCalledWith('Нет доступа к этому разделу', 'error');
  });

  it('оператор на экране диспетчера → /operator', () => {
    renderAt('/dispatcher/day/2026-09-28', authAs('operator', 'authenticated'));
    expect(screen.getByTestId('url')).toHaveTextContent('/operator');
  });

  it('своя роль — экран', () => {
    renderAt('/dispatcher', authAs('dispatcher', 'authenticated'));
    expect(screen.getByText('DS-01')).toBeInTheDocument();
    expect(notify).not.toHaveBeenCalled();
  });

  it('пока профиль грузится — лоадер, без редиректа', () => {
    renderAt('/dispatcher', authAs(null, 'loading'));
    expect(screen.getByRole('status', { name: /Загрузка/ })).toBeInTheDocument();
    expect(screen.getByTestId('url')).toHaveTextContent('/dispatcher');
  });
});

/**
 * Обвязка для тестов экранов оператора: react-query, сессия, тосты и роутер в памяти.
 * Только для *.test.tsx — приложение этот файл не импортирует.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { configure, render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation, type MemoryRouterProps } from 'react-router-dom';
import { afterEach, vi } from 'vitest';
import type { UserOut } from '@/api/types';
import { AuthContext, type AuthContextValue } from '@/auth/useAuth';
import { NotifyProvider } from '@/lib/notify';

/*
 * Для всех тестов оператора: ByRole без проверки видимости через getComputedStyle — в jsdom она
 * медленная (на загруженной машине — секунды на запрос); паузы 300 мс (поиск, окна) — запас для
 * find* и времени на сценарий из нескольких шагов.
 */
configure({ defaultHidden: true, asyncUtilTimeout: 4000 });
vi.setConfig({ testTimeout: 30_000 });

// регион оператора запоминается в sessionStorage — каждый тест начинает с чистой вкладки
afterEach(() => {
  window.sessionStorage.clear();
});

export const TEST_OPERATOR: UserOut = {
  id: 'op-1',
  login: 'operator',
  name: 'Оператор',
  role: 'operator',
  region_ids: ['east', 'south_east', 'south_center'],
};

export function testQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}

function authAs(user: UserOut): AuthContextValue {
  return { user, role: 'operator', status: 'authenticated', login: vi.fn(), logout: vi.fn() };
}

// eslint-disable-next-line react-refresh/only-export-components -- обвязка тестов, не модуль приложения
function LocationProbe() {
  const { pathname, search } = useLocation();
  return <output data-testid="location">{pathname + search}</output>;
}

type InitialEntry = NonNullable<MemoryRouterProps['initialEntries']>[number];

export interface RenderOptions {
  /** Шаблон пути экрана: '/operator', '/operator/reschedule/:id'. */
  path: string;
  /** Адрес при старте (можно со `state`). */
  url: InitialEntry;
  user?: UserOut;
  client?: QueryClient;
}

/** Экран на своём маршруте; текущий адрес — в `getByTestId('location')`. */
export function renderScreen(
  ui: ReactElement,
  { path, url, user = TEST_OPERATOR, client }: RenderOptions,
) {
  const queryClient = client ?? testQueryClient();
  const result = render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={authAs(user)}>
        <NotifyProvider>
          <MemoryRouter
            initialEntries={[url]}
            future={{ v7_startTransition: false, v7_relativeSplatPath: true }}
          >
            <Routes>
              <Route path={path} element={ui} />
              <Route path="*" element={null} />
            </Routes>
            <LocationProbe />
          </MemoryRouter>
        </NotifyProvider>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
  return { ...result, client: queryClient };
}

/** Обёртка для renderHook: react-query и сессия оператора. */
export function hookWrapper(user: UserOut = TEST_OPERATOR, client = testQueryClient()) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <AuthContext.Provider value={authAs(user)}>{children}</AuthContext.Provider>
      </QueryClientProvider>
    );
  };
}

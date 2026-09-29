/**
 * Тестовые данные и обвязка экранов инженера. Только для тестов: ответы по форме
 * `/engineers/me/day` (FRONTEND_SPEC §5.2), бэк в тестах подменяется через vi.mock('@/api/engineer').
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { vi } from 'vitest';
import type { EngineerMeDay, EngineerVisit, UserOut } from '@/api/types';
import { AuthContext, type AuthContextValue } from '@/auth/useAuth';

export function visitRaw(
  id: string,
  sequence: number,
  status: string,
  extra: Partial<EngineerVisit> = {},
): EngineerVisit {
  return {
    request_id: id,
    sequence,
    status,
    flags: [],
    type_bk: 'Подключение',
    type_hd: `Заявка ${sequence}`,
    address: `Город Москва, ул.Окская, д. ${sequence}, кв. 13`,
    district: 'Кузьминки',
    window: '14:00-16:00',
    arrival: `${String(9 + sequence).padStart(2, '0')}:30`,
    start: `${String(9 + sequence).padStart(2, '0')}:40`,
    duration_minutes: 70,
    leg_km: 1.6,
    gigabit: false,
    technology: 'FTTB',
    why_you: 'навык — подключения, окно 14–16',
    ...extra,
  };
}

export function dayRaw(
  visits: EngineerVisit[],
  extra: Partial<EngineerMeDay> & { shift_status?: string } = {},
): EngineerMeDay {
  const { shift_status = 'on_shift', ...rest } = extra;
  return {
    date: '2026-09-29',
    plan_published: true,
    engineer: {
      id: 'E01',
      name: 'А. Мельников',
      transport: 'car',
      shift_start: '10:00',
      shift_end: '22:00',
      shift_status,
      start: { kind: 'office', address: 'Город Москва, ул.Юных Ленинцев, д. 83 стр. 4' },
    },
    summary: { total: visits.length, done: 0, first_start: '10:20' },
    active_request_id: null,
    visits,
    banners: [],
    ...rest,
  };
}

const USER: UserOut = {
  id: 'u-eng',
  login: 'eng-east-01',
  name: 'Инженер из профиля',
  role: 'engineer',
  engineer_id: 'E01',
};

export const authValue = (overrides: Partial<AuthContextValue> = {}): AuthContextValue => ({
  user: USER,
  role: 'engineer',
  status: 'authenticated',
  login: vi.fn(),
  logout: vi.fn(async () => {}),
  ...overrides,
});

/** Текущий адрес — для проверок переходов. */
function LocationProbe() {
  const { pathname, search } = useLocation();
  return createElement('output', { 'data-testid': 'location' }, pathname + search);
}

/**
 * Экраны инженера в роутере с чистым кэшем: `/engineer` и `/engineer/request/:id`.
 * Повторов нет — ошибка сети видна сразу.
 */
export function renderEngineer(
  routes: { home: ReactElement; card?: ReactElement },
  url = '/engineer',
  auth: AuthContextValue = authValue(),
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  const tree = createElement(
    QueryClientProvider,
    { client },
    createElement(
      AuthContext.Provider,
      { value: auth },
      createElement(
        MemoryRouter,
        {
          initialEntries: [url],
          future: { v7_startTransition: false, v7_relativeSplatPath: true },
        },
        createElement(
          Routes,
          null,
          createElement(Route, { path: '/engineer', element: routes.home }),
          routes.card &&
            createElement(Route, { path: '/engineer/request/:id', element: routes.card }),
        ),
        createElement(LocationProbe),
      ),
    ),
  );
  return { client, auth, ...render(tree) };
}

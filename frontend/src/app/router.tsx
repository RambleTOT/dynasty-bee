import { createBrowserRouter, Outlet, type RouteObject } from 'react-router-dom';
import { AuthProvider } from '@/auth/AuthProvider';
import { LoginPage } from '@/features/auth/LoginPage';
import { NotFound } from '@/pages/NotFound';
import { RealtimeProvider } from '@/realtime/RealtimeProvider';
import { ErrorFallback } from './ErrorBoundary';
import { MobileLayout } from './layouts/MobileLayout';
import { RequireRole } from './RequireRole';
import { RoleHome } from './RoleHome';
import {
  CalendarPage,
  DayPage,
  DispatcherLayout,
  EngineerApp,
  NewRequestPage,
  OperatorLayout,
  ReschedulePage,
  SearchPage,
  VisitCardPage,
} from './screens';

/**
 * Экраны — маршруты (FRONTEND_SPEC §4). Модальные экраны (DS-02, DS-04…DS-10, шторки инженера) —
 * не маршруты, а query-параметры страницы: `request`, `proposal`, `modal=…`, `sheet=…`.
 *
 * У каждой ветки роли два `errorElement`: внутренний (без пути) ловит ошибки экранов и оставляет
 * шапку с «Выйти», внешний — ошибки самого лейаута.
 */
export const routes: RouteObject[] = [
  {
    element: (
      <AuthProvider>
        <RealtimeProvider>
          <Outlet />
        </RealtimeProvider>
      </AuthProvider>
    ),
    errorElement: <ErrorFallback />,
    children: [
      { path: '/', element: <RoleHome /> },
      { path: '/login', element: <LoginPage /> },
      {
        path: '/dispatcher',
        element: (
          <RequireRole role="dispatcher">
            <DispatcherLayout />
          </RequireRole>
        ),
        errorElement: <ErrorFallback />,
        children: [
          {
            errorElement: <ErrorFallback />,
            children: [
              { index: true, element: <CalendarPage /> },
              { path: 'day/:date', element: <DayPage /> },
            ],
          },
        ],
      },
      {
        path: '/operator',
        element: (
          <RequireRole role="operator">
            <OperatorLayout />
          </RequireRole>
        ),
        errorElement: <ErrorFallback />,
        children: [
          {
            errorElement: <ErrorFallback />,
            children: [
              { index: true, element: <SearchPage /> },
              { path: 'new', element: <NewRequestPage /> },
              { path: 'reschedule/:id', element: <ReschedulePage /> },
            ],
          },
        ],
      },
      {
        path: '/engineer',
        element: (
          <RequireRole role="engineer">
            <MobileLayout />
          </RequireRole>
        ),
        errorElement: <ErrorFallback />,
        children: [
          {
            errorElement: <ErrorFallback />,
            children: [
              { index: true, element: <EngineerApp /> },
              { path: 'request/:id', element: <VisitCardPage /> },
            ],
          },
        ],
      },
      { path: '*', element: <NotFound /> },
    ],
  },
];

export const router = createBrowserRouter(routes, {
  future: {
    v7_relativeSplatPath: true,
    v7_fetcherPersist: true,
    v7_normalizeFormMethod: true,
    v7_partialHydration: true,
    v7_skipActionErrorRevalidation: true,
  },
});

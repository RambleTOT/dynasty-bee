import { lazy } from 'react';

// Экраны ролей грузятся отдельными чанками: инженеру на телефоне не нужны карта и экраны диспетчера.
export const DispatcherLayout = lazy(() => import('@/features/dispatcher/DispatcherLayout'));
export const CalendarPage = lazy(() => import('@/features/dispatcher/calendar/CalendarPage'));
export const DayPage = lazy(() => import('@/features/dispatcher/day/DayPage'));
export const OperatorLayout = lazy(() => import('@/features/operator/OperatorLayout'));
export const SearchPage = lazy(() => import('@/features/operator/search/SearchPage'));
export const NewRequestPage = lazy(() => import('@/features/operator/booking/NewRequestPage'));
export const ReschedulePage = lazy(() => import('@/features/operator/reschedule/ReschedulePage'));
export const EngineerApp = lazy(() => import('@/features/engineer/EngineerApp'));
export const VisitCardPage = lazy(() => import('@/features/engineer/VisitCardPage'));

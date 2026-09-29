/**
 * Обвязка тестов окон дня диспетчера (DS-05, DS-08, DS-09, DS-10): react-query, тосты и действия дня.
 * Только для *.test.tsx — приложение этот файл не импортирует. Бэк в тестах подменяется через vi.mock('@/api/…').
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { configure, render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { vi } from 'vitest';
import type { DayChain } from '@/adapters/dayChain';
import { useDayActions, type DayActions } from '@/features/dispatcher/day/useDayActions';
import { NotifyProvider } from '@/lib/notify';

// ByRole без проверки видимости (в jsdom она медленная) и запас времени для find* на загруженной машине
configure({ defaultHidden: true, asyncUtilTimeout: 4000 });
vi.setConfig({ testTimeout: 30_000 });

export function dayTestClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}

export function renderDay(ui: ReactElement, client: QueryClient = dayTestClient()) {
  const result = render(
    <QueryClientProvider client={client}>
      <NotifyProvider>{ui}</NotifyProvider>
    </QueryClientProvider>,
  );
  return { ...result, client };
}

// eslint-disable-next-line react-refresh/only-export-components -- обвязка тестов, не модуль приложения
function ActionsHost({
  date,
  children,
}: {
  date: string;
  children: (actions: DayActions) => ReactNode;
}) {
  const actions = useDayActions(date);
  return <>{children(actions)}</>;
}

/** Окно с настоящими действиями дня (useDayActions) поверх подменённых ручек API. */
export function withDayActions(
  date: string,
  render: (actions: DayActions) => ReactNode,
): ReactElement {
  return <ActionsHost date={date}>{render}</ActionsHost>;
}

/** Цепочка версий, которой хватает окнам: номер версии и голова. */
export const testChain: DayChain = {
  headPlanId: 'P1',
  version: 4,
  versions: [],
  pendingProposals: [],
  staleProposals: [],
  consumed: new Map(),
  cancelledIds: new Set(),
  events: [],
  planStatus: new Map(),
};

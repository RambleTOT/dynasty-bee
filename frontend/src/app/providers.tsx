import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import type { ReactNode } from 'react';
import { queryClient } from '@/api/queryClient';
import { NotifyProvider } from '@/lib/notify';

/** Провайдеры вне роутера. Сессия (AuthProvider) — внутри роутера, см. router.tsx. */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <NotifyProvider>{children}</NotifyProvider>
      {import.meta.env.DEV && <ReactQueryDevtools buttonPosition="bottom-left" />}
    </QueryClientProvider>
  );
}

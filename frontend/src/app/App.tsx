import { RouterProvider } from 'react-router-dom';
import { ErrorBoundary } from './ErrorBoundary';
import { AppProviders } from './providers';
import { router } from './router';
import { useNewVersionNotice } from './useNewVersion';

export function App() {
  useNewVersionNotice();
  return (
    <ErrorBoundary>
      <AppProviders>
        {/* Без startTransition: при выходе токен и адрес меняются в одном рендере (AuthProvider). */}
        <RouterProvider router={router} future={{ v7_startTransition: false }} />
      </AppProviders>
    </ErrorBoundary>
  );
}

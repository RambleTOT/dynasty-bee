import { QueryClient } from '@tanstack/react-query';
import { isApiError } from './errors';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // 4xx повтором не лечится; сеть и 5xx — до 2 повторов.
        retry: (failureCount, error) => {
          if (isApiError(error) && error.status >= 400 && error.status < 500) return false;
          return failureCount < 2;
        },
        refetchOnWindowFocus: false,
        staleTime: 5_000,
        refetchIntervalInBackground: false,
      },
    },
  });
}

export const queryClient = createQueryClient();

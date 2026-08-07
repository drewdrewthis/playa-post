import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContext, useContext, useMemo, type JSX, type ReactNode } from 'react';

import { useAccessTokenReader } from '../auth/session-provider';

import { createPlayaPostClient, type PlayaPostClient } from './client';

const ApiContext = createContext<PlayaPostClient | null>(null);

/**
 * The API client and the query cache, mounted once.
 *
 * `retry: false` is deliberate and offline-shaped: a retrying query while the device
 * is offline produces a stream of failures that look like server errors, and the
 * offline story here is the Dexie store plus an explicit replay (ADR-0005), not
 * transport-level optimism. Cached data stays rendered; the failure is recorded once.
 */
export function ApiProvider({ children }: { readonly children: ReactNode }): JSX.Element {
  const readAccessToken = useAccessTokenReader();

  const client = useMemo(
    () =>
      createPlayaPostClient({
        // Relative: the dev/preview server proxies `/trpc` to the API, so the browser
        // and the API are same-origin. See `apps/web/vite.config.ts`.
        url: '/trpc',
        accessToken: readAccessToken,
      }),
    [readAccessToken],
  );

  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            refetchOnWindowFocus: false,
            staleTime: 5_000,
          },
          mutations: { retry: false },
        },
      }),
    [],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ApiContext.Provider value={client}>{children}</ApiContext.Provider>
    </QueryClientProvider>
  );
}

/** The API client, from anywhere inside {@link ApiProvider}. */
export function useApi(): PlayaPostClient {
  const client = useContext(ApiContext);

  if (client === null) {
    throw new Error('useApi must be used inside an <ApiProvider>.');
  }

  return client;
}

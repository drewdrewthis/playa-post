import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, type JSX, type ReactNode } from 'react';

import { useApi } from '../api/api-provider';

import { offlineDatabase, type OfflineDatabase } from './database';
import { createSyncRunner, type SyncRunner } from './sync-runner';

export interface OfflineContextValue {
  readonly database: OfflineDatabase;
  readonly syncRunner: SyncRunner;
}

const OfflineContext = createContext<OfflineContextValue | null>(null);

/**
 * The offline store and its drainer, mounted once.
 *
 * Replay is triggered on **app start** and on the browser's `online` event, and
 * nowhere else. No timer: `attempts` is recorded and displayed, not yet acted on
 * (ADR-0005 leaves backoff to M5), and a background retry loop would clear the badge
 * a user is still looking at.
 */
export function OfflineProvider({ children }: { readonly children: ReactNode }): JSX.Element {
  const api = useApi();
  const queryClient = useQueryClient();

  const value = useMemo<OfflineContextValue>(() => {
    const syncRunner = createSyncRunner({
      database: offlineDatabase,
      api,
      onSettled: () => {
        // The queue is the source of truth for what changed; the server is the source
        // of truth for what it now looks like. Refetching is how those meet.
        void queryClient.invalidateQueries();
      },
    });

    return { database: offlineDatabase, syncRunner };
  }, [api, queryClient]);

  useEffect(() => {
    const drain = (): void => {
      void value.syncRunner.drain();
    };

    drain();
    window.addEventListener('online', drain);

    return () => window.removeEventListener('online', drain);
  }, [value]);

  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}

/** The offline store and drainer, from anywhere inside {@link OfflineProvider}. */
export function useOffline(): OfflineContextValue {
  const value = useContext(OfflineContext);

  if (value === null) {
    throw new Error('useOffline must be used inside an <OfflineProvider>.');
  }

  return value;
}

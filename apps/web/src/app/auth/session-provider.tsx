import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react';

import { readHarnessSession, type Session, type SessionStatus } from './session';
import { createSupabaseAuthClient, type AuthClient } from './supabase-auth-client';

export interface SessionContextValue {
  readonly status: SessionStatus;
  readonly accessToken: string | null;
  /** Sends a magic link. The session arrives through {@link AuthClient.onSessionChange}. */
  requestSignInLink(email: string): Promise<void>;
  signOut(): Promise<void>;
  /**
   * Drop the local session because the server refused the token.
   *
   * Separate from {@link signOut} on purpose: `signOut` is a user's decision and tells
   * the issuer about it; this is the app reacting to an `UNAUTHORIZED` and must not
   * depend on a network round-trip that may itself be failing.
   */
  clearRejectedSession(): void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/**
 * Holds "who is signed in" for the whole app, and nothing else.
 *
 * The token is exposed through a **ref-backed getter** to `api/client.ts` rather than
 * closed over, so a silent refresh reaches the very next request without rebuilding
 * the tRPC client.
 */
export function SessionProvider({
  children,
  authClient,
}: {
  readonly children: ReactNode;
  /** Injectable for tests; the app uses the Supabase-backed one. */
  readonly authClient?: AuthClient;
}): JSX.Element {
  const client = useMemo(() => authClient ?? createSupabaseAuthClient(), [authClient]);
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<SessionStatus>('loading');

  useEffect(() => {
    let active = true;

    // The harness seed is read first and synchronously: in a development build it is
    // already in `localStorage` before the first paint, and waiting on Supabase's
    // async restore first would render one anonymous frame and redirect to `/signin`.
    const seeded = readHarnessSession();

    if (seeded !== null) {
      setSession(seeded);
      setStatus('signed-in');
      return () => {
        active = false;
      };
    }

    void client.currentSession().then((restored) => {
      if (!active) {
        return;
      }

      setSession(restored);
      setStatus(restored === null ? 'anonymous' : 'signed-in');
    });

    const unsubscribe = client.onSessionChange((next) => {
      setSession(next);
      setStatus(next === null ? 'anonymous' : 'signed-in');
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [client]);

  const requestSignInLink = useCallback(
    (email: string) => client.requestSignInLink(email),
    [client],
  );

  const signOut = useCallback(async () => {
    await client.signOut();
    setSession(null);
    setStatus('anonymous');
  }, [client]);

  const clearRejectedSession = useCallback(() => {
    setSession(null);
    setStatus('anonymous');
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({
      status,
      accessToken: session?.accessToken ?? null,
      requestSignInLink,
      signOut,
      clearRejectedSession,
    }),
    [status, session, requestSignInLink, signOut, clearRejectedSession],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/** The session, from anywhere inside {@link SessionProvider}. */
export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);

  if (value === null) {
    throw new Error('useSession must be used inside a <SessionProvider>.');
  }

  return value;
}

/**
 * A stable getter for the current access token.
 *
 * `api/client.ts` needs the token at request time, not at render time — this is the
 * one seam that hands it over without making the client a React value.
 */
export function useAccessTokenReader(): () => string | null {
  const { accessToken } = useSession();
  const latest = useRef<string | null>(accessToken);

  latest.current = accessToken;

  return useCallback(() => latest.current, []);
}

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Session } from './session';

/**
 * The port the app signs in through.
 *
 * A port rather than a direct `@supabase/supabase-js` call in the provider, because
 * "who issued this session" is the one boundary the e2e is allowed to stand in for and
 * the deployment is allowed to change (ADR-0011: the `SUPABASE_URL` line decides whose
 * users this app accepts). Everything past the returned token is the same code in
 * every environment.
 */
export interface AuthClient {
  /** The restored session, or `null` when nobody is signed in. */
  currentSession(): Promise<Session | null>;
  /** Send a magic link. Delivery is the issuer's job; this returns once it is queued. */
  requestSignInLink(email: string): Promise<void>;
  /**
   * Verify the one-time code the same email carries (issue #179). A magic link opens
   * the system browser, which never hands a session to an installed PWA; the code is
   * the same credential over a channel the PWA can complete itself. Success arrives
   * the same way a magic-link click's would: through {@link onSessionChange}.
   */
  verifySignInCode(email: string, code: string): Promise<void>;
  signOut(): Promise<void>;
  /** Fires on every session change, including a silent token refresh. */
  onSessionChange(listener: (session: Session | null) => void): () => void;
}

/**
 * Supabase Auth is not configured for this build.
 *
 * A named state rather than a crash at the first click: a local checkout with no
 * `.env` should render a sign-in screen that says what is missing, not a blank page —
 * and a build that silently pretended to sign someone in would be worse than either.
 */
export class AuthNotConfiguredError extends Error {
  constructor() {
    super('Supabase Auth is not configured: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are unset.');
    this.name = 'AuthNotConfiguredError';
  }
}

function supabaseClient(): SupabaseClient | null {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (typeof url !== 'string' || url === '' || typeof anonKey !== 'string' || anonKey === '') {
    return null;
  }

  return createClient(url, anonKey);
}

/**
 * The real client: `@supabase/supabase-js`, which owns session persistence and the
 * refresh schedule this lane would otherwise have to write (addendum §18).
 */
export function createSupabaseAuthClient(): AuthClient {
  const client = supabaseClient();

  if (client === null) {
    return unconfiguredAuthClient();
  }

  return {
    async currentSession(): Promise<Session | null> {
      const { data } = await client.auth.getSession();
      const accessToken = data.session?.access_token;

      return typeof accessToken === 'string' ? { accessToken } : null;
    },

    async requestSignInLink(email: string): Promise<void> {
      const { error } = await client.auth.signInWithOtp({ email });

      if (error !== null) {
        throw error;
      }
    },

    async verifySignInCode(email: string, code: string): Promise<void> {
      const { error } = await client.auth.verifyOtp({ email, token: code, type: 'email' });

      if (error !== null) {
        throw error;
      }
    },

    async signOut(): Promise<void> {
      await client.auth.signOut();
    },

    onSessionChange(listener): () => void {
      const { data } = client.auth.onAuthStateChange((_event, session) => {
        const accessToken = session?.access_token;

        listener(typeof accessToken === 'string' ? { accessToken } : null);
      });

      return () => data.subscription.unsubscribe();
    },
  };
}

/** Every operation refuses, by name. Nothing here pretends a session exists. */
function unconfiguredAuthClient(): AuthClient {
  return {
    currentSession: () => Promise.resolve(null),
    requestSignInLink: () => Promise.reject(new AuthNotConfiguredError()),
    verifySignInCode: () => Promise.reject(new AuthNotConfiguredError()),
    signOut: () => Promise.resolve(),
    onSessionChange: () => () => undefined,
  };
}

import { useQuery } from '@tanstack/react-query';
import { useEffect, type JSX, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';

import { useApi } from '../api/api-provider';
import { procedureErrorCode } from '../api/client';
import { hasSeenWelcome } from '../welcome/welcome-steps';

import { useSession } from './session-provider';

const ONBOARDING_PATH = '/onboarding';
const SIGN_IN_PATH = '/signin';
const WELCOME_PATH = '/welcome';

/**
 * The gate every signed-in route sits behind.
 *
 * Three outcomes, and the third is the one that is easy to get wrong:
 *
 * 1. **Anonymous** → `/signin`.
 * 2. **A valid token whose user has not onboarded** → `/onboarding`, and no graph or
 *    board content renders on the way past.
 * 3. **A token the server refuses** → signed-out and back to `/signin` — never a blank
 *    page, never an unhandled rejection, and never a retry loop (AC-L5-7).
 *
 * The onboarding probe is `graph.list`, an ordinary authenticated procedure, rather
 * than a dedicated "am I onboarded" endpoint: the server already answers the question
 * (`authenticatedProcedure` throws `FORBIDDEN` for a signed-in-but-not-onboarded
 * principal), and the graph home needs the payload anyway, so React Query serves both
 * from one request.
 *
 * ⚠ Once the probe has succeeded, its cached data keeps the children mounted even
 * while a later refetch fails. That is what lets the app stay usable offline instead
 * of bouncing to `/signin` the moment the network drops — a dropped connection is not
 * an authorization answer.
 */
/**
 * A one-line status where a whole screen would otherwise be.
 *
 * Framed like every other screen rather than left as a bare paragraph: these three
 * states (restoring, offline, loading) are the first thing a user sees on a cold or bad
 * start, and unstyled text on a white page reads as a crash rather than as a wait.
 */
function SessionNotice({ children }: { readonly children: ReactNode }): JSX.Element {
  return (
    <div className="app-frame">
      <main className="app-column">
        <div className="screen screen--fill screen--centred">
          <p className="screen__notice">{children}</p>
        </div>
      </main>
    </div>
  );
}

export function RequireSession({ children }: { readonly children: ReactNode }): JSX.Element {
  const { status, clearRejectedSession } = useSession();
  const api = useApi();
  const location = useLocation();

  const probe = useQuery({
    queryKey: ['graph', 'list'],
    queryFn: () => api.query('graph.list', undefined),
    enabled: status === 'signed-in',
  });

  const rejected = procedureErrorCode(probe.error) === 'UNAUTHORIZED';

  useEffect(() => {
    if (rejected) {
      clearRejectedSession();
    }
  }, [rejected, clearRejectedSession]);

  if (status === 'loading') {
    return <SessionNotice>Restoring your session…</SessionNotice>;
  }

  if (status === 'anonymous') {
    // A first-ever visit gets the pitch before the form; the welcome screen itself
    // drops through to `/signin`. One device-scoped flag decides, so a returning
    // signed-out user is never made to sit through it again.
    return <Navigate to={hasSeenWelcome() ? SIGN_IN_PATH : WELCOME_PATH} replace />;
  }

  // Cached data outranks a live error: see the offline note above.
  if (probe.data !== undefined) {
    return <>{children}</>;
  }

  if (probe.error !== null) {
    const code = procedureErrorCode(probe.error);

    if (code === 'UNAUTHORIZED') {
      return <Navigate to={SIGN_IN_PATH} replace />;
    }

    if (code === 'FORBIDDEN' && location.pathname !== ONBOARDING_PATH) {
      return <Navigate to={ONBOARDING_PATH} replace />;
    }

    if (code === null) {
      // Not the server refusing — a transport failure. Say so; do not sign anyone out.
      return <SessionNotice>You are offline. Reconnect to load this view.</SessionNotice>;
    }
  }

  if (location.pathname === ONBOARDING_PATH) {
    return <>{children}</>;
  }

  return <SessionNotice>Loading…</SessionNotice>;
}

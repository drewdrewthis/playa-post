import { useQuery } from '@tanstack/react-query';
import { useEffect, type JSX, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';

import { useApi } from '../api/api-provider';
import { procedureErrorCode } from '../api/client';

import { useSession } from './session-provider';

const ONBOARDING_PATH = '/onboarding';
const SIGN_IN_PATH = '/signin';

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
    return <p className="app-shell__notice">Restoring your session…</p>;
  }

  if (status === 'anonymous') {
    return <Navigate to={SIGN_IN_PATH} replace />;
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
      return <p className="app-shell__notice">You are offline. Reconnect to load this view.</p>;
    }
  }

  if (location.pathname === ONBOARDING_PATH) {
    return <>{children}</>;
  }

  return <p className="app-shell__notice">Loading…</p>;
}

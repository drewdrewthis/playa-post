import { useEffect, type JSX } from 'react';
import { Link, useRouteError } from 'react-router';

import { ROUTE_CRASH_BODY, ROUTE_CRASH_TITLE } from './route-error-copy';
import { describeThrownForLog, errorDigest } from './route-error-log';
import { RouteMessageScreen } from './route-message-screen';

/**
 * The root route's `errorElement` (issue #125): catches a throw anywhere in the tree
 * and answers with the app's own screen instead of React Router's developer error page.
 *
 * Crash copy only, with no not-found branch. React Router raises a 404 route error
 * response for a path nothing matched — but the `*` catch-all matches every path, and
 * the tree has no loaders or actions to raise one from, so a throw that reaches here is
 * always a genuine fault.
 */
export function RouteErrorScreen(): JSX.Element {
  const error = useRouteError();

  useEffect(() => {
    // Keyed on `error`, not run on every render: production diagnostics need this
    // once per failure, not once per re-render of the fallback it produced.
    //
    // The described form, never the thrown value — see `route-error-log.ts`.
    console.error(describeThrownForLog(error));
  }, [error]);

  return (
    <RouteMessageScreen testId="route-error" title={ROUTE_CRASH_TITLE} body={ROUTE_CRASH_BODY}>
      {/*
        The screen this replaced was React Router's, and its raw stack trace was the
        only diagnostic a bug report ever carried. This digest is the redacted
        replacement: stable per fault, safe to screenshot, and it costs the reporter
        nothing to include.
      */}
      <p className="screen__aside">{errorDigest(error, window.location.pathname)}</p>

      <button
        className="button button--primary"
        data-testid="route-error-reload"
        type="button"
        onClick={() => {
          window.location.reload();
        }}
      >
        Reload
      </button>

      <Link className="button" data-testid="route-error-home" to="/">
        Back to the graph
      </Link>

      <button
        className="button"
        data-testid="route-error-reset"
        type="button"
        onClick={clearThisDevice}
      >
        Sign out and clear this device
      </button>
    </RouteMessageScreen>
  );
}

/**
 * The escape hatch for a fault the device is holding on to.
 *
 * When the throw's cause is persisted — a corrupt session, an offline record that
 * cannot be replayed — Reload and Back to the graph both walk straight back into it,
 * and the shell's own sign-out is above this boundary and therefore unreachable. This
 * is the only control on the screen that can end that loop.
 *
 * Self-contained on purpose: no provider is mounted above an `errorElement`, so there
 * is no session or offline context to ask. It also clears the theme choice, which
 * `localStorage` holds under `playapost-theme` — an accepted cost for one button that
 * has to work when nothing else does.
 */
function clearThisDevice(): void {
  window.localStorage.clear();

  // The name `offline/database.ts` opens. Written as a literal rather than imported:
  // that module constructs its Dexie instance at import time, and this screen exists
  // precisely because something below it already threw.
  const deletion = window.indexedDB.deleteDatabase('playa-post');

  // Leaving before the delete settles can cancel it, which would strand the very record
  // that caused the throw. `blocked` — another tab holding the database open — still
  // leaves: the cleared storage above has already dropped the session, and waiting on a
  // tab the user cannot see would strand them here instead.
  const leave = (): void => {
    window.location.assign('/');
  };

  deletion.onsuccess = leave;
  deletion.onerror = leave;
  deletion.onblocked = leave;
}

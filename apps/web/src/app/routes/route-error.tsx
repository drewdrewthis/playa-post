import { useEffect, type JSX } from 'react';
import { Link, useRouteError } from 'react-router';

import { describeRouteError } from './route-error-copy';

/**
 * The root route's `errorElement` (issue #125): catches a render, loader, or action
 * throw anywhere in the tree and answers with the app's own screen instead of React
 * Router's developer error page.
 *
 * Reuses the not-found screen's `not-found-home` testid on purpose: both a crash and
 * an unmatched address end at the same way back, and a walk that only knows the way
 * back by that testid should not have to branch on which screen produced it.
 */
export function RouteErrorScreen(): JSX.Element {
  const error = useRouteError();
  const { kind, title, body } = describeRouteError(error);

  useEffect(() => {
    // Keyed on `error`, not run on every render: production diagnostics need this
    // once per failure, not once per re-render of the fallback it produced.
    console.error(error);
  }, [error]);

  return (
    <div className="app-frame">
      <main className="app-column" data-testid="route-error">
        <div className="screen screen--fill screen--centred">
          <h1 className="screen__title">{title}</h1>
          <p className="screen__lede">{body}</p>

          {kind === 'crash' ? (
            // Absent for `not-found`: reloading a wrong address changes nothing about
            // it, so the only honest control there is the way back.
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
          ) : null}

          <Link
            className={kind === 'crash' ? 'button' : 'button button--primary'}
            data-testid="not-found-home"
            to="/"
          >
            Back to the graph
          </Link>
        </div>
      </main>
    </div>
  );
}

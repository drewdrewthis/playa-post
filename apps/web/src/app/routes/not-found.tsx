import type { JSX } from 'react';
import { Link } from 'react-router';

import { NOT_FOUND_BODY, NOT_FOUND_TITLE } from './route-error-copy';

/**
 * The `*` catch-all (issue #125): before this route existed, a URL nothing else
 * matched fell through to React Router's own developer error page in production —
 * "Unexpected Application Error!", "Hey developer" banner and all.
 *
 * Deliberately public, like `welcome.tsx`: a mistyped or stale link has to answer for
 * *anyone* who follows it, signed in or not, so this screen sits outside
 * `RequireSession` rather than behind it — an unknown address must not also demand
 * sign-in before it will say so.
 */
export function NotFoundRoute(): JSX.Element {
  return (
    <div className="app-frame">
      <main className="app-column" data-testid="not-found">
        <div className="screen screen--fill screen--centred">
          <h1 className="screen__title">{NOT_FOUND_TITLE}</h1>
          <p className="screen__lede">{NOT_FOUND_BODY}</p>
          <Link className="button button--primary" data-testid="not-found-home" to="/">
            Back to the graph
          </Link>
        </div>
      </main>
    </div>
  );
}

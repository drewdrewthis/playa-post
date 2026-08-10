import { useEffect, type JSX } from 'react';
import { Link, useLocation } from 'react-router';

import { NOT_FOUND_BODY, NOT_FOUND_TITLE } from './route-error-copy';
import { RouteMessageScreen } from './route-message-screen';

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
  const { pathname } = useLocation();

  useEffect(() => {
    // A catch-all is an excellent place to lose a bug: a `<Link to="/boad">` typo now
    // renders a polished screen instead of a stack trace, and nobody hears about it.
    // Development says so out loud; `import.meta.env.DEV` is the literal `false` in
    // `vite build`, so the branch is not in the shipped bundle.
    if (import.meta.env.DEV) {
      console.warn(`No route matched ${pathname} — rendering the not-found screen.`);
    }
  }, [pathname]);

  return (
    <RouteMessageScreen testId="not-found" title={NOT_FOUND_TITLE} body={NOT_FOUND_BODY}>
      <Link className="button button--primary" data-testid="not-found-home" to="/">
        Back to the graph
      </Link>
    </RouteMessageScreen>
  );
}

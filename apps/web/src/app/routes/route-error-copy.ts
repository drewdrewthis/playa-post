import { isRouteErrorResponse } from 'react-router';

/**
 * What a route failure screen shows — kept as data, not JSX, so the router's
 * `errorElement` and the `*` catch-all can render the same shape from two different
 * triggers (issue #125).
 */
export interface RouteErrorCopy {
  readonly kind: 'not-found' | 'crash';
  readonly title: string;
  readonly body: string;
}

/** The `*` catch-all's copy: nothing broke, the address just doesn't lead anywhere. */
export const NOT_FOUND_TITLE = 'Nothing pinned here';
export const NOT_FOUND_BODY =
  'This address doesn’t point at anything — the dust moves things around out here. Find your way back from the graph.';

/** The `errorElement`'s copy for everything that isn't a 404 route error response. */
export const ROUTE_CRASH_TITLE = 'This screen hit something it couldn’t clear';
export const ROUTE_CRASH_BODY =
  'Reloading usually fixes it. If it keeps happening, come back in a bit.';

/**
 * Turns whatever a route threw into copy this app can show in its own voice, rather
 * than React Router's developer screen.
 *
 * A 404 route error response — what `isRouteErrorResponse` recognises, and what React
 * Router itself throws for a path nothing matched — is the only case with a different
 * story: nothing broke, the address just doesn't point anywhere. A route error response
 * carrying any other status (a loader's 500, say) is not that story, so it falls
 * through with every other thrown value, `Error` or not, to the crash copy.
 */
export function describeRouteError(error: unknown): RouteErrorCopy {
  if (isRouteErrorResponse(error) && error.status === 404) {
    return { kind: 'not-found', title: NOT_FOUND_TITLE, body: NOT_FOUND_BODY };
  }

  return { kind: 'crash', title: ROUTE_CRASH_TITLE, body: ROUTE_CRASH_BODY };
}

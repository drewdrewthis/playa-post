import { describe, expect, it } from 'vitest';

import {
  describeRouteError,
  NOT_FOUND_BODY,
  NOT_FOUND_TITLE,
  ROUTE_CRASH_BODY,
  ROUTE_CRASH_TITLE,
} from './route-error-copy';

/**
 * Shaped exactly as react-router's own `isRouteErrorResponse` checks it — `status`,
 * `statusText`, `internal`, `data` — rather than an `ErrorResponse` instance, since
 * that is the real contract this module reads (react-router's dist chunk).
 */
function routeErrorResponse(status: number): unknown {
  return { status, statusText: 'Not Found', internal: false, data: null };
}

describe('describeRouteError', () => {
  it('reads a 404 route error response as not-found, in the app’s own words', () => {
    expect(describeRouteError(routeErrorResponse(404))).toEqual({
      kind: 'not-found',
      title: NOT_FOUND_TITLE,
      body: NOT_FOUND_BODY,
    });
  });

  it('reads a plain thrown Error as a crash', () => {
    expect(describeRouteError(new Error('boom'))).toEqual({
      kind: 'crash',
      title: ROUTE_CRASH_TITLE,
      body: ROUTE_CRASH_BODY,
    });
  });

  it('reads a non-Error throw as a crash too', () => {
    expect(describeRouteError('a string someone threw')).toEqual({
      kind: 'crash',
      title: ROUTE_CRASH_TITLE,
      body: ROUTE_CRASH_BODY,
    });
  });

  // Beyond the three required cases: the 404 check has to be specific to 404, not to
  // "any route error response", or a loader's 500 would read as an unknown address.
  it('reads a non-404 route error response as a crash, not as not-found', () => {
    expect(describeRouteError(routeErrorResponse(500)).kind).toBe('crash');
  });
});

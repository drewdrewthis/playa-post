import { generateCorrelationId } from '@playa-post/observability';

import {
  authenticateRequest,
  type AuthenticationOutcome,
} from '../shared/auth/authenticate-request';
import type { RequestContext } from '../shared/trpc/request-context';

import type { AppContainer } from './container';

/** The parts of an inbound request the composition root needs to build a scope from. */
export interface IncomingRequest {
  /** Raw `Authorization` header value, or `undefined` when the client sent none. */
  readonly authorizationHeader?: string | undefined;
}

/**
 * Build one request's scope: correlation ID, bound logger, resolved authentication.
 *
 * ADR-0003's second lifetime, and the only one besides the container. Everything here
 * is genuinely per-request (addendum §12); a stateless service that appears in this
 * function is a bug, because it will be rebuilt on every call for no benefit.
 *
 * **The correlation ID is always generated here and never read from a request
 * header.** Accepting a client-supplied value would let a caller stamp arbitrary text
 * onto every log line of its own requests — a log-injection and log-poisoning surface
 * for nothing we need in M2, since there is no upstream service to propagate a trace
 * from. Revisit when one exists, and validate the inbound value then.
 *
 * Authentication is resolved **once per request, on first ask** — the credentials are
 * captured here and turned into an `AuthenticationOutcome` the first time a procedure
 * needs one, then memoised. "Once" is ADR-0008 rule 8: no procedure downstream ever
 * sees a token, and no two procedures in one request can disagree about who is
 * calling. "On first ask" is what keeps a public procedure public.
 *
 * **Building a scope performs no I/O, and that is load-bearing.** Verifying a token
 * can fetch the project's JWKS and resolving an actor reads `app.users`; paying both
 * up front would make `health.check` — whose whole purpose is to answer while
 * dependencies are down — fail with a 500 whenever the database is unreachable, and
 * Render would pull a healthy instance out of rotation on the strength of it. This
 * function is therefore synchronous, which is the honest signature for work that
 * touches nothing.
 *
 * @param container - The application's object graph.
 * @param request - The inbound request's credentials.
 * @returns the tRPC context for this request. Rejections are not thrown: an
 *   unauthenticated or un-onboarded request still gets a scope, and
 *   `authenticatedProcedure` decides what that means per procedure.
 */
export function buildRequestScope(
  container: AppContainer,
  request: IncomingRequest,
): RequestContext {
  const correlationId = generateCorrelationId();

  // Memoised by holding the promise, not the resolved value: two concurrent
  // procedures in one request must share one in-flight resolution rather than race
  // to start a second. A rejection is cached with the same reasoning — one request,
  // one answer, even when the answer is a fault.
  let outcome: Promise<AuthenticationOutcome> | undefined;

  return {
    correlationId,
    logger: container.logger.child({ correlationId }),
    authentication: () =>
      (outcome ??= authenticateRequest(request.authorizationHeader, {
        accessTokenVerifier: container.accessTokenVerifier,
        actorResolver: container.actorResolver,
      })),
  };
}

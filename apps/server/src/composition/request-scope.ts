import { generateCorrelationId } from '@playa-post/observability';

import { authenticateRequest } from '../shared/auth/authenticate-request';
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
 * Authentication is resolved **once, here**, so no procedure downstream ever sees a
 * token and no two procedures in one request can disagree about who is calling
 * (ADR-0008 rule 8).
 *
 * @param container - The application's object graph.
 * @param request - The inbound request's credentials.
 * @returns the tRPC context for this request. Rejections are not thrown: an
 *   unauthenticated or un-onboarded request still gets a scope, and
 *   `authenticatedProcedure` decides what that means per procedure.
 */
export async function buildRequestScope(
  container: AppContainer,
  request: IncomingRequest,
): Promise<RequestContext> {
  const correlationId = generateCorrelationId();

  const authentication = await authenticateRequest(request.authorizationHeader, {
    accessTokenVerifier: container.accessTokenVerifier,
    actorResolver: container.actorResolver,
  });

  return {
    correlationId,
    logger: container.logger.child({ correlationId }),
    authentication,
  };
}

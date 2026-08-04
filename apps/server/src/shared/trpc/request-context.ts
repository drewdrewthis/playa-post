import type { Logger } from '@playa-post/observability';

import type { AuthenticationOutcome } from '../auth/authenticate-request';

/**
 * Everything one request carries, built once at the transport boundary.
 *
 * This is both the tRPC context type and ADR-0003's `RequestScope` — deliberately one
 * type under one name, because they are one object: "the per-request slice of the
 * container" and "what a procedure receives" describe the same thing from two
 * directions, and two names for it would be two things to keep in sync.
 * `composition/request-scope.ts` builds it; `shared/trpc/trpc.ts` consumes it.
 *
 * Only genuinely request-scoped concerns belong here (addendum §12): the authenticated
 * actor, the correlation ID, the request logger, and — when transactions arrive — the
 * transaction context. **Stateless services do not.** They live on the container and
 * are injected into module factories once; putting one here would re-create it per
 * request for no reason and blur what "scope" means.
 *
 * ⚠ It holds an {@link AuthenticationOutcome}, not an `Actor`. A procedure that needs
 * an actor uses `authenticatedProcedure`, which narrows the context and adds `actor`
 * and `viewerId`. Reading `authentication.actor` by hand inside a `publicProcedure`
 * is how an authorization check gets skipped without anything failing.
 */
export interface RequestContext {
  /**
   * Ties every log line and span from this request together
   * (`generateCorrelationId()`, addendum §12).
   */
  readonly correlationId: string;
  /**
   * The container's logger with `correlationId` already bound.
   *
   * Its field allowlist is `@playa-post/observability`'s, so a call site that passes a
   * bulletin body emits no bulletin body (M1-AC11). That is a backstop, not a licence.
   */
  readonly logger: Logger;
  /** What this request's credentials turned out to be. Resolved once, here. */
  readonly authentication: AuthenticationOutcome;
}

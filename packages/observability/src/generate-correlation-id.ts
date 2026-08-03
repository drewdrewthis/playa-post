import { randomUUID } from 'node:crypto';

/**
 * Mint a new correlation ID for one request's worth of logs and spans.
 *
 * Not a secret and not derived from anything sensitive, so a standard
 * `crypto.randomUUID()` is sufficient — unlike an invitation token
 * (M2-AC17), a correlation ID never needs to resist guessing, only
 * collision. Centralized here so the generation strategy has one home and
 * can change without touching every call site.
 *
 * The addendum §12 request-scoped concerns include "Request correlation
 * ID"; wiring this into a request scope is `composition/`'s job, not this
 * package's — it only provides the value.
 *
 * @example
 * ```ts
 * const correlationId = generateCorrelationId();
 * const requestLogger = logger.child({ correlationId });
 * ```
 */
export function generateCorrelationId(): string {
  return randomUUID();
}

/** Body of `GET /healthz`. Deliberately carries no build, version, or dependency detail. */
export interface HealthResponse {
  readonly status: 'ok';
}

/** Path both HTTP entrypoints mount the liveness check on. */
export const HEALTH_PATH = '/healthz';

/**
 * Liveness answer, shared by the Node and Cloudflare entrypoints.
 *
 * Runtime-agnostic on purpose: it touches no request object, no framework, and
 * no I/O. ADR-0001 keeps the deployment choice reversible by requiring both
 * entrypoints to build from day one — that guarantee is only worth something if
 * the behaviour they expose is *one* thing rather than two literals that can
 * drift apart.
 *
 * It must not query the database: a health check that fails when a dependency is
 * slow turns one degraded dependency into a restart loop.
 */
export function readHealth(): HealthResponse {
  return { status: 'ok' };
}

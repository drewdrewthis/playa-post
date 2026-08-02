/** Body of `GET /healthz`. Deliberately carries no build, version, or dependency detail. */
export interface HealthResponse {
  readonly status: 'ok';
}

/**
 * Path the HTTP entrypoint mounts the liveness check on.
 *
 * Also what Render polls: `render.yaml`'s `healthCheckPath` must equal this
 * string, and `health.unit.test.ts` asserts it does. A rename here that misses
 * the blueprint leaves the service permanently "unhealthy" and unrouted — a
 * failure that only shows up in a deploy, which is why it is asserted in a test
 * that runs on every commit.
 */
export const HEALTH_PATH = '/healthz';

/**
 * Liveness answer.
 *
 * Runtime-agnostic on purpose: it touches no request object, no framework, and
 * no I/O, so the HTTP entrypoint contributes only routing. That is the shape
 * addendum §22 asks for — a different host or server library changes the
 * entrypoint and nothing else (ADR-0009).
 *
 * It must not query the database: a health check that fails when a dependency is
 * slow turns one degraded dependency into a restart loop, and on Render a failing
 * health check pulls the instance out of rotation.
 */
export function readHealth(): HealthResponse {
  return { status: 'ok' };
}

/** Body of `GET /healthz`. Deliberately carries no build, version, or dependency detail. */
export interface HealthResponse {
  readonly status: 'ok';
}

/**
 * Path the HTTP entrypoint mounts the liveness check on, and what Render polls.
 *
 * Renaming it means editing `render.yaml` too —
 * `tests/fitness/render-blueprint.fitness.test.ts` enforces that and explains why.
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

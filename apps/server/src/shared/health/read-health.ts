/** Body of the liveness answer. Deliberately carries no build, version, or dependency detail. */
export interface HealthResponse {
  readonly status: 'ok';
}

/**
 * Liveness answer, shared by the `GET /healthz` route and the `health.check` tRPC
 * procedure so the two cannot drift into disagreeing about whether this process is up.
 *
 * Transport-agnostic on purpose: it touches no request object, no framework, and no
 * I/O, so each transport contributes only routing. That is the shape addendum §22 asks
 * for — a different host or server library changes the entrypoint and nothing else
 * (ADR-0009).
 *
 * It lives under `shared/` rather than in the HTTP entrypoint because the tRPC router
 * consumes it: `shared/ → entrypoints/` would invert the one dependency direction
 * ADR-0009 relies on to keep the deployment reversible. `HEALTH_PATH` stays in
 * `entrypoints/http/health.ts`, because a URL path genuinely is an HTTP concern.
 *
 * It must not query the database: a health check that fails when a dependency is slow
 * turns one degraded dependency into a restart loop, and on Render a failing health
 * check pulls the instance out of rotation.
 */
export function readHealth(): HealthResponse {
  return { status: 'ok' };
}

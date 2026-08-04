/**
 * Path the HTTP entrypoint mounts the liveness check on, and what Render polls.
 *
 * Renaming it means editing `render.yaml` too —
 * `tests/fitness/render-blueprint.fitness.test.ts` enforces that and explains why.
 *
 * The payload itself is not here: `readHealth()` lives in `shared/health/read-health.ts`
 * because the `health.check` tRPC procedure returns it too, and `shared/` must not
 * import an entrypoint. A URL path, by contrast, is nothing *but* an HTTP concern, so
 * it stays where the runtime binding is (addendum §22, ADR-0009).
 */
export const HEALTH_PATH = '/healthz';

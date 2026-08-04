import { readHealth, type HealthResponse } from '../health/read-health';

import { publicProcedure, router } from './trpc';

/**
 * The root router — the registry every module's router is mounted on.
 *
 * **How a lane adds its module** (lane-brief C5): give this function a parameter for
 * the module's router and append one line to the `router({ … })` literal, in the same
 * PR as the module's first procedure. A registered-but-empty router is the placeholder
 * addendum §4 forbids.
 *
 * ```ts
 * export function createAppRouter(modules: { identity: IdentityRouter }) {
 *   return router({ health: healthRouter, identity: modules.identity });
 * }
 * ```
 *
 * Routers are **passed in, never imported here.** `shared/` importing `modules/` would
 * make the shared transport layer depend on every feature it is supposed to be
 * independent of, and would put a cycle one careless import away. Composition is the
 * layer that is allowed to know every module exists (ADR-0003).
 *
 * It is a factory rather than a module-scope constant so that the wiring happens once,
 * explicitly, where the container is built — and so a test can build a router without
 * inheriting whatever the process happens to have registered.
 */
export function createAppRouter() {
  return router({
    health: router({
      /**
       * Liveness over tRPC.
       *
       * Not a duplicate of `GET /healthz`: they answer different questions to
       * different callers. `/healthz` is Render's probe and its contract is with the
       * host — the fitness test pins the path, and a change there pulls the instance
       * out of rotation. `health.check` answers "is the API I speak reachable", which
       * a client asks over the same transport, with the same headers and the same
       * middleware stack, as everything else it calls. They share `readHealth()` so
       * they cannot disagree about the answer.
       *
       * Public, and the only procedure here that should be: a liveness check that
       * requires a session cannot tell you the service is up when your session is the
       * thing that is broken.
       */
      check: publicProcedure.query((): HealthResponse => readHealth()),
    }),
  });
}

/**
 * The router's type, and the only thing a client should ever import from the server.
 *
 * When `apps/web` grows a tRPC client (M2.16), `createTRPCClient<AppRouter>` needs
 * this type and nothing else — no runtime code crosses. Route it through
 * `packages/contracts`, which is the only legal import surface from the web app
 * (`no-web-to-server-internals`); see that package's README on the promotion rule
 * before doing so.
 */
export type AppRouter = ReturnType<typeof createAppRouter>;

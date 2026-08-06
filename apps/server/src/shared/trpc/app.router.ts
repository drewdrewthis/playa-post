import type { ConnectionsRouter } from '../../modules/connections/transport/connections.router';
import type { GraphRouter } from '../../modules/graph/transport/graph.router';
import type { IdentityRouter } from '../../modules/identity/transport/identity.router';
import { readHealth, type HealthResponse } from '../health/read-health';

import { publicProcedure, router } from './trpc';

/**
 * The module routers the root router mounts. One entry per lane, added with that
 * lane's first procedure.
 */
export interface AppRouterModules {
  readonly identity: IdentityRouter;
  readonly connections: ConnectionsRouter;
  readonly graph: GraphRouter;
}

/**
 * The root router — the registry every module's router is mounted on.
 *
 * **How a lane adds its module** (lane-brief C5): add its router to
 * {@link AppRouterModules} and append one line to the `router({ … })` literal, in the
 * same PR as the module's first procedure. A registered-but-empty router is the
 * placeholder addendum §4 forbids.
 *
 * Router **values** are passed in, never imported here; only their *types* are named,
 * which is what {@link AppRouterModules} does and what makes `AppRouter` describe the
 * real surface a client will type against (M2.16). `shared/` constructing a module's
 * router would make the shared transport layer depend on every feature it is supposed
 * to be independent of, and would put a runtime cycle one careless import away.
 * Composition is the layer that is allowed to build them (ADR-0003).
 *
 * It is a factory rather than a module-scope constant so that the wiring happens once,
 * explicitly, where the container is built — and so a test can build a router without
 * inheriting whatever the process happens to have registered.
 */
export function createAppRouter(modules: AppRouterModules) {
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
    identity: modules.identity,
    connections: modules.connections,
    graph: modules.graph,
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

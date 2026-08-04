import { fastifyTRPCPlugin, type FastifyTRPCPluginOptions } from '@trpc/server/adapters/fastify';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';

import type { AppContainer } from '../../composition/container';
import { buildRequestScope } from '../../composition/request-scope';
import { readHealth, type HealthResponse } from '../../shared/health/read-health';
import type { AppRouter } from '../../shared/trpc/app.router';

import { HEALTH_PATH } from './health';

/**
 * Path prefix every tRPC procedure is served under.
 *
 * Distinct from `HEALTH_PATH` and from any future REST surface, so "is this a
 * procedure call" is answerable from the URL alone — which is what lets `/healthz`
 * stay a plain route with no middleware, and what will let a proxy or rate limiter
 * treat the two differently without parsing bodies.
 */
export const TRPC_PREFIX = '/trpc';

/**
 * Build the Node HTTP entrypoint.
 *
 * Its single responsibility is *runtime binding*: turn the object graph into a
 * listening-capable server and mount transports on it. It holds no product behavior,
 * and per addendum §22 it is the only layer allowed to know that the runtime is Node +
 * Fastify at all — moving off Render, or off Fastify, must be a change to this file
 * and its `main.ts`, never to a module (ADR-0009).
 *
 * Returned rather than started, so tests can drive it through `inject()` without
 * binding a port.
 *
 * @param container - The application's object graph, already built by the composition
 *   root. Taking the container rather than a `Configuration` is exactly what
 *   `no-container-outside-composition` permits an entrypoint to do, and nothing else.
 */
export function createHttpServer(container: AppContainer): FastifyInstance {
  const server = Fastify({
    // The container's logger, not a second one Fastify builds for itself. That logger
    // is pino with `@playa-post/observability`'s field allowlist applied (M1-AC11), so
    // every line Fastify emits goes through the same redaction as every line a
    // procedure emits. A second, unfiltered logger would be a hole in the control
    // rather than a convenience. Widened to `FastifyBaseLogger` so Fastify's logger
    // generic stays at its default and the return type remains the plain
    // `FastifyInstance` callers expect (pino's `Logger` is a structural superset).
    loggerInstance: container.logger satisfies FastifyBaseLogger as FastifyBaseLogger,
    // Fastify's automatic per-request line logs the full URL — and a tRPC query
    // carries its input in the query string. That is `?input={"handle":"…"}` in a log
    // file, which is exactly the leak M2-AC16 greps for. Request-level observability
    // belongs to the tRPC layer, where the payload is a structured object the
    // allowlist can filter, not a string already concatenated into a URL.
    disableRequestLogging: true,
  });

  // Liveness only, and delegated rather than inlined: the payload Render's health
  // check reads is `readHealth()`'s, so this route contributes routing and nothing
  // else. Mounted outside the tRPC prefix so the probe never runs auth middleware.
  server.get(HEALTH_PATH, (): HealthResponse => readHealth());

  server.register(fastifyTRPCPlugin, {
    prefix: TRPC_PREFIX,
    trpcOptions: {
      router: container.router,
      // One request scope per request, built by the composition root. This is the
      // only place the raw Authorization header is read; past it, "who is calling" is
      // a resolved value (ADR-0008 rule 8).
      createContext: ({ req }) =>
        buildRequestScope(container, { authorizationHeader: req.headers.authorization }),
      // Log the failure without logging the failure's contents: `route` and `code`
      // survive the allowlist, the error message does not. An unhandled 500 that
      // leaves no trace is undebuggable; one that pastes a bulletin body into a log
      // file is a breach.
      onError({ error, path }) {
        container.logger.error({ route: path, code: error.code }, 'trpc procedure failed');
      },
    } satisfies FastifyTRPCPluginOptions<AppRouter>['trpcOptions'],
  });

  return server;
}

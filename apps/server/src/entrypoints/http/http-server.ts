import Fastify, { type FastifyInstance } from 'fastify';

import type { Configuration } from '../../composition/config';

/** Body of `GET /healthz`. Deliberately carries no build, version, or dependency detail. */
export interface HealthResponse {
  readonly status: 'ok';
}

/**
 * Build the HTTP entrypoint.
 *
 * Its single responsibility is *runtime binding*: turn configuration into a
 * listening-capable server and mount transports on it. It holds no product
 * behavior, and per addendum §22 it is the only layer allowed to know that the
 * runtime is Node + Fastify at all — the same modules must mount unchanged on a
 * Cloudflare Worker entrypoint.
 *
 * Returned rather than started, so tests can drive it through `inject()` without
 * binding a port.
 *
 * @param configuration - Already-validated configuration from the composition root.
 */
export function createHttpServer(configuration: Configuration): FastifyInstance {
  // Fastify's logger is pino — the "mature structured logger" of addendum §18,
  // not a wrapper around one. `logLevel: 'silent'` is how tests stay quiet.
  const server = Fastify({ logger: { level: configuration.logLevel } });

  // Liveness only. It must not query the database: a health check that fails when
  // a dependency is slow turns one degraded dependency into a restart loop.
  server.get('/healthz', (): HealthResponse => ({ status: 'ok' }));

  return server;
}

import Fastify, { type FastifyInstance } from 'fastify';

import type { Configuration } from '../../composition/config';

import { HEALTH_PATH, readHealth, type HealthResponse } from './health';

/**
 * Build the Node HTTP entrypoint.
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

  // Liveness only, and shared with the Cloudflare entrypoint so the two runtimes
  // cannot drift (ADR-0001 rule 2).
  server.get(HEALTH_PATH, (): HealthResponse => readHealth());

  return server;
}

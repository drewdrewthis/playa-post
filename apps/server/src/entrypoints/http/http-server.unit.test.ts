import { afterEach, describe, expect, it } from 'vitest';

import type { Configuration } from '../../composition/config';

import { HEALTH_PATH, readHealth } from './health';
import { createHttpServer } from './http-server';

const testConfiguration: Configuration = {
  nodeEnv: 'test',
  host: '127.0.0.1',
  port: 0,
  logLevel: 'silent',
};

describe('createHttpServer', () => {
  let server: ReturnType<typeof createHttpServer> | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('answers GET /healthz without binding a port or touching a dependency', async () => {
    server = createHttpServer(testConfiguration);

    const response = await server.inject({ method: 'GET', url: HEALTH_PATH });

    expect(response.statusCode).toBe(200);
    // Compared against readHealth() rather than a literal so the expectation has
    // one source. This does NOT catch an inlined literal in http-server.ts — the
    // payloads would be identical and both assertions would pass; an earlier
    // comment here claimed otherwise.
    expect(response.json()).toEqual(readHealth());
  });

  it('404s an unmounted route — nothing is registered implicitly', async () => {
    server = createHttpServer(testConfiguration);

    const response = await server.inject({ method: 'GET', url: '/not-a-route' });

    expect(response.statusCode).toBe(404);
  });

  // Carried over from the deleted Worker entrypoint's suite. Non-vacuous now that
  // /healthz is polled from the public internet: the liveness probe is a GET, and
  // the path must not quietly accept anything else.
  it('404s a non-GET request to the health path', async () => {
    server = createHttpServer(testConfiguration);

    const response = await server.inject({ method: 'POST', url: HEALTH_PATH });

    expect(response.statusCode).toBe(404);
  });
});

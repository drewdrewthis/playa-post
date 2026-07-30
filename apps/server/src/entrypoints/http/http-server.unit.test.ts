import { afterEach, describe, expect, it } from 'vitest';

import type { Configuration } from '../../composition/config';

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

    const response = await server.inject({ method: 'GET', url: '/healthz' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('404s an unmounted route — nothing is registered implicitly', async () => {
    server = createHttpServer(testConfiguration);

    const response = await server.inject({ method: 'GET', url: '/not-a-route' });

    expect(response.statusCode).toBe(404);
  });
});

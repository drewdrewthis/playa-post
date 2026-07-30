import { describe, expect, it } from 'vitest';

import worker from './cloudflare-worker';
import { createHttpServer } from './http-server';

describe('cloudflare worker entrypoint', () => {
  it('answers GET /healthz', async () => {
    const response = worker.fetch(new Request('https://playa.post/healthz'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'ok' });
  });

  it('404s an unmounted route', () => {
    expect(worker.fetch(new Request('https://playa.post/not-a-route')).status).toBe(404);
  });

  it('404s a non-GET request to the health path', () => {
    const response = worker.fetch(
      new Request('https://playa.post/healthz', { method: 'POST' }),
    );

    expect(response.status).toBe(404);
  });

  // The reversibility guarantee ADR-0001 actually cares about: not "both files
  // compile" but "both runtimes say the same thing". If someone edits one
  // entrypoint's health payload, this fails.
  it('returns byte-identical health output to the Node entrypoint', async () => {
    const server = createHttpServer({
      nodeEnv: 'test',
      host: '127.0.0.1',
      port: 0,
      logLevel: 'silent',
    });

    try {
      const node = await server.inject({ method: 'GET', url: '/healthz' });
      const cloudflare = await worker.fetch(new Request('https://playa.post/healthz')).json();

      expect(node.json()).toEqual(cloudflare);
    } finally {
      await server.close();
    }
  });
});

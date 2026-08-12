import { afterEach, describe, expect, it } from 'vitest';

import {
  generateSupabaseSigningKeyPair,
  mintSupabaseAsymmetricUserToken,
} from '@playa-post/testing';

import type { Configuration } from '../../composition/config';
import { buildAppContainer, type AppContainer } from '../../composition/container';
import { createSupabaseJwtVerifier } from '../../shared/auth/supabase-jwt-verifier';
import { readHealth } from '../../shared/health/read-health';

import { HEALTH_PATH } from './health';
import { createHttpServer, TRPC_PREFIX } from './http-server';

const projectKey = await generateSupabaseSigningKeyPair();

const testConfiguration: Configuration = {
  nodeEnv: 'test',
  host: '127.0.0.1',
  port: 0,
  logLevel: 'silent',
  databaseUrl: 'postgres://app_rw@127.0.0.1:1/nothing_listening_here',
  supabaseUrl: 'https://project-that-does-not-exist.supabase.co',
  purgeRetentionDays: 30,
  webPush: null,
};

describe('createHttpServer', () => {
  let server: ReturnType<typeof createHttpServer> | undefined;
  let container: AppContainer | undefined;

  function start(): ReturnType<typeof createHttpServer> {
    container = {
      ...buildAppContainer(testConfiguration),
      // The verifier stays real — same algorithm pin, same claim assertions (ADR-0011).
      // Only its key source is local, so this suite never fetches the project's JWKS.
      accessTokenVerifier: createSupabaseJwtVerifier({ keySource: projectKey.publicKey }),
    };
    server = createHttpServer(container);
    return server;
  }

  afterEach(async () => {
    await server?.close();
    await container?.dispose();
    server = undefined;
    container = undefined;
  });

  describe('the liveness probe Render polls', () => {
    it('answers GET /healthz without binding a port or touching a dependency', async () => {
      const response = await start().inject({ method: 'GET', url: HEALTH_PATH });

      expect(response.statusCode).toBe(200);
      // Compared against readHealth() rather than a literal so the expectation has
      // one source. This does NOT catch an inlined literal in http-server.ts — the
      // payloads would be identical and both assertions would pass.
      expect(response.json()).toEqual(readHealth());
    });

    it('404s an unmounted route — nothing is registered implicitly', async () => {
      const response = await start().inject({ method: 'GET', url: '/not-a-route' });

      expect(response.statusCode).toBe(404);
    });

    // Non-vacuous now that /healthz is polled from the public internet: the liveness
    // probe is a GET, and the path must not quietly accept anything else.
    it('404s a non-GET request to the health path', async () => {
      const response = await start().inject({ method: 'POST', url: HEALTH_PATH });

      expect(response.statusCode).toBe(404);
    });

    // The probe must stay outside the tRPC prefix. Mounted inside it, /healthz would
    // acquire the auth middleware stack and Render would poll an endpoint that can
    // 401 — which reads as an unhealthy instance and pulls it out of rotation.
    it('serves the probe outside the tRPC prefix', () => {
      expect(HEALTH_PATH.startsWith(TRPC_PREFIX)).toBe(false);
    });
  });

  describe('the tRPC transport', () => {
    it('serves health.check under the tRPC prefix with the same payload', async () => {
      const response = await start().inject({
        method: 'GET',
        url: `${TRPC_PREFIX}/health.check`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ result: { data: readHealth() } });
    });

    it('404s a procedure that does not exist', async () => {
      const response = await start().inject({
        method: 'GET',
        url: `${TRPC_PREFIX}/nothing.here`,
      });

      expect(response.statusCode).toBe(404);
    });

    // Proves the context factory ran on a real request: a valid, correctly-signed
    // token is accepted by the real verifier, and rejected only by the onboarding
    // check — which is exactly the state L0 ships in (no app.users yet).
    it('runs the context factory, resolving a real token to a not-onboarded session', async () => {
      const token = await mintSupabaseAsymmetricUserToken({
        signingKey: projectKey,
        role: 'authenticated',
      });

      const response = await start().inject({
        method: 'GET',
        url: `${TRPC_PREFIX}/health.check`,
        headers: { authorization: `Bearer ${token}` },
      });

      // health.check is public, so the session state does not change its answer — the
      // assertion is that presenting a token neither breaks the request nor changes
      // the payload. The 401/403 surfaces arrive with L1's first guarded procedure
      // (M2-AC2's curl transcripts).
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ result: { data: readHealth() } });
    });

    it('accepts a request with no credentials at all', async () => {
      const response = await start().inject({
        method: 'GET',
        url: `${TRPC_PREFIX}/health.check`,
      });

      expect(response.statusCode).toBe(200);
    });
  });
});

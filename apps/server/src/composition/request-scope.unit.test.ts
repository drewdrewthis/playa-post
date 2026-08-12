import { describe, expect, it } from 'vitest';

import {
  generateSupabaseSigningKeyPair,
  mintSupabaseAsymmetricUserToken,
} from '@playa-post/testing';

import type { Actor } from '../shared/auth/actor';
import type { ActorResolver } from '../shared/auth/actor-resolver';
import { createSupabaseJwtVerifier } from '../shared/auth/supabase-jwt-verifier';

import type { Configuration } from './config';
import { buildAppContainer, type AppContainer } from './container';
import { buildRequestScope } from './request-scope';

const projectKey = await generateSupabaseSigningKeyPair();
const otherProjectKey = await generateSupabaseSigningKeyPair();
const actor: Actor = { userId: 'app-user-1', handle: 'dusty_rhodes' };

const configuration: Configuration = {
  nodeEnv: 'test',
  host: '127.0.0.1',
  port: 0,
  logLevel: 'silent',
  databaseUrl: 'postgres://app_rw@127.0.0.1:1/nothing_listening_here',
  supabaseUrl: 'https://project-that-does-not-exist.supabase.co',
  purgeRetentionDays: 30,
  webPush: null,
};

/**
 * The real container with two collaborators swapped, for two different reasons.
 *
 * `actorResolver` is the L1 seam, exercised early — the part L1 owns (`app.users`)
 * stood in for. The **verifier itself stays real**; only where it gets a public key
 * changes, from the project's JWKS endpoint to a key pair generated in this process.
 * That keeps the token path genuine — same algorithm pin, same four assertions
 * (ADR-0011) — while keeping the unit suite off the network. The wiring assertion the
 * swap gives up (that the container really points at the project's JWKS) lives in
 * `container.unit.test.ts`, where it can be made without one.
 */
function containerResolving(resolved: Actor | null): AppContainer {
  const resolver: ActorResolver = { resolve: () => Promise.resolve(resolved) };
  return {
    ...buildAppContainer(configuration),
    accessTokenVerifier: createSupabaseJwtVerifier({ keySource: projectKey.publicKey }),
    actorResolver: resolver,
  };
}

describe('buildRequestScope', () => {
  it('mints a fresh correlation id per request', async () => {
    const container = containerResolving(actor);

    const [first, second] = await Promise.all([
      buildRequestScope(container, {}),
      buildRequestScope(container, {}),
    ]);

    expect(first.correlationId).not.toBe(second.correlationId);
    await container.dispose();
  });

  it('never takes the correlation id from the request', async () => {
    const container = containerResolving(actor);

    // A client-supplied correlation id is arbitrary text stamped onto every log line
    // of its own requests — log injection for no benefit, since M2 has no upstream
    // service to propagate a trace from.
    const scope = await buildRequestScope(container, {
      authorizationHeader: undefined,
    });

    expect(scope.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    await container.dispose();
  });

  it('binds the correlation id onto the request logger', async () => {
    const container = containerResolving(actor);

    const scope = await buildRequestScope(container, {});

    expect(scope.logger).toBeDefined();
    expect(scope.logger).not.toBe(container.logger);
    await container.dispose();
  });

  it('is anonymous when the request carries no credentials', async () => {
    const container = containerResolving(actor);

    const scope = await buildRequestScope(container, {});

    await expect(scope.authentication()).resolves.toEqual({ kind: 'anonymous' });
    await container.dispose();
  });

  it('resolves a real Supabase-shaped token all the way to an actor', async () => {
    const container = containerResolving(actor);
    const token = await mintSupabaseAsymmetricUserToken({
      signingKey: projectKey,
      role: 'authenticated',
      subject: 'auth-user-1',
    });

    const scope = await buildRequestScope(container, {
      authorizationHeader: `Bearer ${token}`,
    });

    await expect(scope.authentication()).resolves.toEqual({
      kind: 'authenticated',
      principal: { authUserId: 'auth-user-1' },
      actor,
    });
    await container.dispose();
  });

  it('is not-onboarded for a valid token with no product user — M2-AC2’s third case', async () => {
    const container = containerResolving(null);
    const token = await mintSupabaseAsymmetricUserToken({
      signingKey: projectKey,
      role: 'authenticated',
      subject: 'auth-user-1',
    });

    const scope = await buildRequestScope(container, {
      authorizationHeader: `Bearer ${token}`,
    });

    expect((await scope.authentication()).kind).toBe('not-onboarded');
    await container.dispose();
  });

  it('is invalid-token for a token this project did not sign', async () => {
    const container = containerResolving(actor);
    const token = await mintSupabaseAsymmetricUserToken({
      signingKey: otherProjectKey,
      role: 'authenticated',
    });

    const scope = await buildRequestScope(container, {
      authorizationHeader: `Bearer ${token}`,
    });

    await expect(scope.authentication()).resolves.toEqual({ kind: 'invalid-token' });
    await container.dispose();
  });

  it('builds a scope for a rejected request rather than throwing', async () => {
    const container = containerResolving(actor);

    // Rejection is a per-procedure decision, not a transport-level one: a public
    // procedure must still run for an unauthenticated caller, so the scope has to
    // exist either way.
    const scope = await buildRequestScope(container, { authorizationHeader: 'Bearer nonsense' });

    expect(scope.correlationId).toBeDefined();
    expect(scope.logger).toBeDefined();
    await container.dispose();
  });
});

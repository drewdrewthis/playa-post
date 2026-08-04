import { describe, expect, it } from 'vitest';

import { generateJwtSigningSecret, mintSupabaseUserToken } from '@playa-post/testing';

import type { Actor } from '../shared/auth/actor';
import type { ActorResolver } from '../shared/auth/actor-resolver';

import type { Configuration } from './config';
import { buildAppContainer, type AppContainer } from './container';
import { buildRequestScope } from './request-scope';

const supabaseJwtSecret = generateJwtSigningSecret();
const actor: Actor = { userId: 'app-user-1', handle: 'dusty_rhodes' };

const configuration: Configuration = {
  nodeEnv: 'test',
  host: '127.0.0.1',
  port: 0,
  logLevel: 'silent',
  databaseUrl: 'postgres://app_rw@127.0.0.1:1/nothing_listening_here',
  supabaseJwtSecret,
};

/**
 * The real container with one collaborator swapped — the L1 seam, exercised early.
 *
 * Swapping the resolver rather than the verifier is deliberate: the token path stays
 * real, so these tests prove the whole chain from `Authorization` header to `Actor`,
 * with only the part L1 owns (`app.users`) stood in for.
 */
function containerResolving(resolved: Actor | null): AppContainer {
  const resolver: ActorResolver = { resolve: () => Promise.resolve(resolved) };
  return { ...buildAppContainer(configuration), actorResolver: resolver };
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

    expect(scope.authentication).toEqual({ kind: 'anonymous' });
    await container.dispose();
  });

  it('resolves a real Supabase-shaped token all the way to an actor', async () => {
    const container = containerResolving(actor);
    const token = await mintSupabaseUserToken({
      secret: supabaseJwtSecret,
      role: 'authenticated',
      subject: 'auth-user-1',
    });

    const scope = await buildRequestScope(container, {
      authorizationHeader: `Bearer ${token}`,
    });

    expect(scope.authentication).toEqual({
      kind: 'authenticated',
      principal: { authUserId: 'auth-user-1' },
      actor,
    });
    await container.dispose();
  });

  it('is not-onboarded for a valid token with no product user — M2-AC2’s third case', async () => {
    const container = containerResolving(null);
    const token = await mintSupabaseUserToken({
      secret: supabaseJwtSecret,
      role: 'authenticated',
      subject: 'auth-user-1',
    });

    const scope = await buildRequestScope(container, {
      authorizationHeader: `Bearer ${token}`,
    });

    expect(scope.authentication.kind).toBe('not-onboarded');
    await container.dispose();
  });

  it('is invalid-token for a token this project did not sign', async () => {
    const container = containerResolving(actor);
    const token = await mintSupabaseUserToken({
      secret: generateJwtSigningSecret(),
      role: 'authenticated',
    });

    const scope = await buildRequestScope(container, {
      authorizationHeader: `Bearer ${token}`,
    });

    expect(scope.authentication).toEqual({ kind: 'invalid-token' });
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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { generateJwtSigningSecret, mintSupabaseUserToken } from '@playa-post/testing';

import type { Configuration } from './config';
import { buildAppContainer } from './container';

/**
 * A configuration that is complete and syntactically valid but points at nothing.
 *
 * That is the whole point of these tests: `buildAppContainer` must produce a working
 * object graph before any of it is reachable, so `main.ts` can fail fast on bad
 * configuration and register signal handlers before the first socket opens.
 */
const configuration: Configuration = {
  nodeEnv: 'test',
  host: '127.0.0.1',
  port: 0,
  logLevel: 'silent',
  databaseUrl: 'postgres://app_rw@127.0.0.1:1/nothing_listening_here',
  supabaseUrl: 'https://project-that-does-not-exist.supabase.co',
};

/**
 * Stands in for the network, and fails if anything reaches for it.
 *
 * The container's verifier holds a remote JWKS resolver pointed at a project that does
 * not exist. Left unstubbed, an accidental fetch would surface as a slow DNS failure
 * that still made the assertion pass — a unit suite quietly doing I/O. Stubbed, the
 * attempt is visible and assertable.
 */
const networkAttempt = vi.fn(() => Promise.reject(new Error('unit tests do not use the network')));

beforeEach(() => {
  networkAttempt.mockClear();
  vi.stubGlobal('fetch', networkAttempt);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildAppContainer', () => {
  it('builds the whole graph without opening a socket', async () => {
    const container = buildAppContainer(configuration);

    expect(container.logger).toBeDefined();
    expect(container.database).toBeDefined();
    expect(container.accessTokenVerifier).toBeDefined();
    expect(container.actorResolver).toBeDefined();
    expect(container.router).toBeDefined();
    expect(networkAttempt).not.toHaveBeenCalled();

    await container.dispose();
  });

  it('hands configuration through rather than re-reading the environment', () => {
    const container = buildAppContainer(configuration);

    // `composition/config.ts` is the only place in apps/server allowed to touch
    // process.env (addendum §12). A container that read it again would be a second,
    // invisible source of truth — and untestable, since a test cannot vary it.
    expect(container.configuration).toBe(configuration);

    return container.dispose();
  });

  it('wires a verifier pinned to ES256, refusing a legacy HS256 token', async () => {
    const container = buildAppContainer(configuration);

    // Not a re-test of the verifier — an assertion that the *wiring* is the asymmetric
    // one (ADR-0011). A container still verifying against the project's retired shared
    // secret would accept the token below, and nothing else in the repository would
    // notice. The `fetch` assertion is the second half: `jose` checks the algorithm
    // before it resolves a key, so refusing a forged header costs no outbound request.
    const legacyToken = await mintSupabaseUserToken({
      secret: generateJwtSigningSecret(),
      role: 'authenticated',
    });

    await expect(container.accessTokenVerifier.verify(legacyToken)).rejects.toThrow();
    await expect(container.accessTokenVerifier.verify('not-a-token')).rejects.toThrow();
    expect(networkAttempt).not.toHaveBeenCalled();

    await container.dispose();
  });

  it('resolves no actor until an identity module is registered', async () => {
    const container = buildAppContainer(configuration);

    await expect(
      container.actorResolver.resolve({ authUserId: 'auth-user-1' }),
    ).resolves.toBeNull();

    await container.dispose();
  });

  it('serves a router carrying at least one procedure', () => {
    const container = buildAppContainer(configuration);

    expect(Object.keys(container.router._def.procedures)).not.toHaveLength(0);

    return container.dispose();
  });

  it('releases the pool on dispose, so a SIGTERM does not leak a connection', async () => {
    const container = buildAppContainer(configuration);

    await expect(container.dispose()).resolves.toBeUndefined();
  });
});

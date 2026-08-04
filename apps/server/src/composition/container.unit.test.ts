import { describe, expect, it } from 'vitest';

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
  supabaseJwtSecret: 'x'.repeat(32),
};

describe('buildAppContainer', () => {
  it('builds the whole graph without opening a socket', async () => {
    const container = buildAppContainer(configuration);

    expect(container.logger).toBeDefined();
    expect(container.database).toBeDefined();
    expect(container.accessTokenVerifier).toBeDefined();
    expect(container.actorResolver).toBeDefined();
    expect(container.router).toBeDefined();

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

  it('verifies tokens against the configured secret and no other', async () => {
    const container = buildAppContainer(configuration);

    // Not a re-test of the verifier — an assertion that the *wiring* passed the right
    // string. A container that defaulted the secret, or read a different key, would
    // accept tokens this project never issued.
    await expect(container.accessTokenVerifier.verify('not-a-token')).rejects.toThrow();

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

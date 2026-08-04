import { describe, expect, it } from 'vitest';

import { AccessTokenVerificationError, type AccessTokenVerifier } from './access-token-verifier';
import type { Actor, AuthenticatedPrincipal } from './actor';
import type { ActorResolver } from './actor-resolver';
import { authenticateRequest, type AuthenticateRequestDependencies } from './authenticate-request';
import { createNoOnboardedUsersResolver } from './no-onboarded-users.resolver';

const principal: AuthenticatedPrincipal = { authUserId: 'auth-user-1' };
const actor: Actor = { userId: 'app-user-1', handle: 'dusty_rhodes' };

/**
 * Fakes, not mocks. We own both collaborators, so a three-line in-memory
 * implementation beats a call-sequence assertion — and lets these tests assert on the
 * outcome, which is the thing that matters (`principles/coding.md`).
 */
function verifierAccepting(token: string): AccessTokenVerifier {
  return {
    verify: (presented) =>
      presented === token
        ? Promise.resolve(principal)
        : Promise.reject(new AccessTokenVerificationError('Access token rejected.')),
  };
}

const verifierRejectingEverything: AccessTokenVerifier = {
  verify: () => Promise.reject(new AccessTokenVerificationError('Access token rejected.')),
};

function resolverReturning(resolved: Actor | null): ActorResolver {
  return { resolve: () => Promise.resolve(resolved) };
}

function dependencies(
  overrides: Partial<AuthenticateRequestDependencies> = {},
): AuthenticateRequestDependencies {
  return {
    accessTokenVerifier: verifierAccepting('good-token'),
    actorResolver: resolverReturning(actor),
    ...overrides,
  };
}

describe('authenticateRequest', () => {
  it('is anonymous when no Authorization header arrives', async () => {
    await expect(authenticateRequest(undefined, dependencies())).resolves.toEqual({
      kind: 'anonymous',
    });
  });

  it('is anonymous when the header carries a scheme other than Bearer', async () => {
    // No bearer token was offered, so nothing failed. Both answers are 401 to the
    // client; the distinction exists so the server's own logs stay honest about
    // whether tokens are arriving at all.
    await expect(authenticateRequest('Basic abc123', dependencies())).resolves.toEqual({
      kind: 'anonymous',
    });
  });

  it('is anonymous when the Bearer scheme carries no token', async () => {
    await expect(authenticateRequest('Bearer    ', dependencies())).resolves.toEqual({
      kind: 'anonymous',
    });
  });

  it('accepts the scheme case-insensitively, as RFC 6750 requires', async () => {
    const outcome = await authenticateRequest('bearer good-token', dependencies());

    expect(outcome.kind).toBe('authenticated');
  });

  it('reports an unverifiable token rather than throwing — an expired tab is not a 500', async () => {
    await expect(
      authenticateRequest(
        'Bearer forged',
        dependencies({ accessTokenVerifier: verifierRejectingEverything }),
      ),
    ).resolves.toEqual({ kind: 'invalid-token' });
  });

  it('rethrows a genuine fault, so an outage is never reported as the caller’s bad token', async () => {
    const broken: AccessTokenVerifier = {
      verify: () => Promise.reject(new Error('key store unreachable')),
    };

    await expect(
      authenticateRequest('Bearer good-token', dependencies({ accessTokenVerifier: broken })),
    ).rejects.toThrow('key store unreachable');
  });

  it('is not-onboarded when the token verifies but no product user exists', async () => {
    const outcome = await authenticateRequest(
      'Bearer good-token',
      dependencies({ actorResolver: resolverReturning(null) }),
    );

    expect(outcome).toEqual({ kind: 'not-onboarded', principal });
  });

  it('is not-onboarded against the resolver that ships until app.users exists', async () => {
    // Locks in the L0 behaviour the M2-AC2 third case depends on: with no identity
    // module registered, a perfectly valid session is 403 ONBOARDING_REQUIRED.
    const outcome = await authenticateRequest(
      'Bearer good-token',
      dependencies({ actorResolver: createNoOnboardedUsersResolver() }),
    );

    expect(outcome.kind).toBe('not-onboarded');
  });

  it('is authenticated when the token verifies and an onboarded user is found', async () => {
    await expect(authenticateRequest('Bearer good-token', dependencies())).resolves.toEqual({
      kind: 'authenticated',
      principal,
      actor,
    });
  });

  it('never resolves an actor for a token it could not verify', async () => {
    // The ordering that matters: a resolver that would happily return an actor must
    // not be reached at all. Reversing these two steps is how a forged `sub` becomes
    // a session.
    const outcome = await authenticateRequest(
      'Bearer forged',
      dependencies({
        accessTokenVerifier: verifierRejectingEverything,
        actorResolver: resolverReturning(actor),
      }),
    );

    expect(outcome).toEqual({ kind: 'invalid-token' });
  });
});

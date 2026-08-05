import { describe, expect, it } from 'vitest';

import { createResolveActorQuery } from '../../application/resolve-actor.query';
import { USER_STATUS, type User } from '../../domain/user';
import type { NewUser, UserRepository } from '../../domain/user.repository';

/**
 * The fail-closed half of ADR-0008 rule 8, at the level it can be proven cheaply.
 *
 * `tests/integration/actor-resolution.integration.test.ts` drives the same query
 * through the real tRPC middleware against real Postgres — that is the M2-AC2
 * scenario. What it cannot cheaply do is enumerate the lifecycle table: seeding four
 * account states and an unrecognised one costs a container boot per case for a rule
 * that involves no SQL at all.
 *
 * It is also the guard `container.unit.test.ts` gave up when the real resolver
 * replaced `createNoOnboardedUsersResolver`: nothing else asserts that a resolver
 * wired into the container refuses a suspended or erased account.
 *
 * The double is a **fake, not a mock** (`principles/coding.md`): an in-memory
 * implementation of a port we own, asserted on its outcome rather than on which
 * methods were called.
 */

const principal = { authUserId: 'auth-user-1' } as const;

function userWith(status: string): User {
  return {
    id: 'app-user-1',
    authUserId: principal.authUserId,
    handle: 'dusty_rhodes',
    displayName: 'Dusty Rhodes',
    avatarPath: null,
    status,
    createdAt: new Date('2026-08-05T00:00:00.000Z'),
    deactivatedAt: null,
    erasedAt: null,
    version: 1,
  };
}

/** An in-memory {@link UserRepository} holding at most the one user under test. */
function repositoryHolding(user: User | null): UserRepository {
  return {
    findByAuthUserId: (authUserId) =>
      Promise.resolve(user !== null && user.authUserId === authUserId ? user : null),
    findByHandle: () => Promise.resolve(null),
    findByConfusableSkeleton: () => Promise.resolve(null),
    add: (_newUser: NewUser) =>
      Promise.reject(new Error('resolving an actor must never write')),
  };
}

describe('createResolveActorQuery (ADR-0008 rule 8)', () => {
  it('resolves an active user to their internal id and handle', async () => {
    const user = userWith(USER_STATUS.active);
    const resolve = createResolveActorQuery({ users: repositoryHolding(user) });

    await expect(resolve.resolve(principal)).resolves.toEqual({
      userId: user.id,
      handle: user.handle,
    });
  });

  it('resolves the internal id, never the auth user id (ADR-0008 rule 2)', async () => {
    const resolve = createResolveActorQuery({
      users: repositoryHolding(userWith(USER_STATUS.active)),
    });

    const actor = await resolve.resolve(principal);

    // The bug this rules out is one line long and total: an actor carrying
    // `auth.users.id` would make every product foreign key point at the wrong
    // identifier, and the branded ViewerId derived from it would read another
    // person's data if the two ever collided.
    expect(actor?.userId).not.toBe(principal.authUserId);
  });

  it('answers null when no product user exists — onboarding is incomplete', async () => {
    const resolve = createResolveActorQuery({ users: repositoryHolding(null) });

    await expect(resolve.resolve(principal)).resolves.toBeNull();
  });

  // One answer for every non-active state, deliberately: the differences are the
  // account holder's private business and must not be readable off a response
  // (ADR-0002 §10). The transport renders all of them as 403 ONBOARDING_REQUIRED.
  it.each([USER_STATUS.deactivated, USER_STATUS.suspended, USER_STATUS.erased])(
    'answers null for a %s account',
    async (status) => {
      const resolve = createResolveActorQuery({ users: repositoryHolding(userWith(status)) });

      await expect(resolve.resolve(principal)).resolves.toBeNull();
    },
  );

  it('answers null for a status it has never heard of — the rule fails closed', async () => {
    // `app.users.status` is `text` with no check constraint, so a future migration or
    // an operator script can introduce a state this code predates. Failing closed is
    // what stops such a state from silently defaulting to "allowed" (ADR-0002 B11);
    // an allowlist of one is why that is true by construction rather than by review.
    const resolve = createResolveActorQuery({
      users: repositoryHolding(userWith('quarantined')),
    });

    await expect(resolve.resolve(principal)).resolves.toBeNull();
  });
});

import { describe, expect, it } from 'vitest';

import { createUpdateDisplayNameService } from '../../application/update-display-name.service';
import type { User } from '../../domain/user';
import { UserRowMissingError } from '../../domain/user.errors';
import type { NewUser, UserRepository } from '../../domain/user.repository';

/**
 * `specs/features/edit-display-name.feature` — the `@unit` scenarios that need no I/O.
 *
 * The double is a **fake, not a mock** (`principles/coding.md`): an in-memory
 * implementation of a port we own, holding one row and asserted on the row's *state*
 * afterwards rather than on which methods were called. That is what lets the
 * handle-untouched scenario be a real assertion — a call-sequence mock could only say
 * "nothing asked me to write a handle", which is a weaker claim than "the handle is
 * still what it was".
 */

const USER_ID = 'app-user-1';
const OTHER_USER_ID = 'app-user-2';

function userWith(overrides: Partial<User> = {}): User {
  return {
    id: USER_ID,
    authUserId: 'auth-user-1',
    handle: 'dusty_rhodes',
    displayName: 'Dusty Rhodes',
    avatarPath: null,
    status: 'active',
    visibleToDistance: 'sixth',
    createdAt: new Date('2026-08-05T00:00:00.000Z'),
    deactivatedAt: null,
    erasedAt: null,
    version: 1,
    ...overrides,
  };
}

/** An in-memory {@link UserRepository} over a mutable set of rows, keyed by id. */
function repositoryHolding(...rows: readonly User[]): {
  readonly users: UserRepository;
  rowFor(userId: string): User | undefined;
} {
  const stored = new Map(rows.map((row) => [row.id, row]));

  return {
    rowFor: (userId) => stored.get(userId),
    users: {
      findByAuthUserId: () => Promise.resolve(null),
      findByHandle: () => Promise.resolve(null),
      findByConfusableSkeleton: () => Promise.resolve(null),
      findById: (userId) => Promise.resolve(stored.get(userId) ?? null),
      add: (_newUser: NewUser) => Promise.reject(new Error('renaming must never insert')),
      setVisibleToDistance: () =>
        Promise.reject(new Error('renaming must never touch the visibility dial')),
      setDisplayName: (userId, displayName) => {
        const existing = stored.get(userId);

        if (existing === undefined) {
          return Promise.resolve(null);
        }

        // The fake writes the one column the real statement writes, so a service that
        // started sending a handle through this port would have nowhere to put it.
        const updated: User = { ...existing, displayName };
        stored.set(userId, updated);

        return Promise.resolve(updated);
      },
    },
  };
}

describe('createUpdateDisplayNameService (issue #177, AC1/AC2/AC4)', () => {
  describe('A person changes their own display name', () => {
    it('stores the new name and answers with what was stored', async () => {
      const repository = repositoryHolding(userWith());
      const service = createUpdateDisplayNameService({ users: repository.users });

      await expect(service.update(USER_ID, 'Dust Storm')).resolves.toBe('Dust Storm');
      expect(repository.rowFor(USER_ID)?.displayName).toBe('Dust Storm');
    });

    it('answers with the stored row’s value, not the argument it was handed', async () => {
      // The bug this rules out is a service that echoes its own input: a client caching
      // the reply would then hold a value the database never agreed to, and the two
      // would stay apart until something else refetched.
      const repository = repositoryHolding(userWith());
      const service = createUpdateDisplayNameService({
        users: {
          ...repository.users,
          setDisplayName: () => Promise.resolve(userWith({ displayName: 'What Was Stored' })),
        },
      });

      await expect(service.update(USER_ID, 'What Was Asked For')).resolves.toBe(
        'What Was Stored',
      );
    });
  });

  describe('Changing a display name leaves the handle untouched', () => {
    it('leaves handle, visibility, and lifecycle columns exactly as they were (ADR-0008 rule 4)', async () => {
      const before = userWith();
      const repository = repositoryHolding(before);
      const service = createUpdateDisplayNameService({ users: repository.users });

      await service.update(USER_ID, 'Somebody Else Entirely');

      const after = repository.rowFor(USER_ID);
      expect(after?.handle).toBe(before.handle);
      expect(after?.visibleToDistance).toBe(before.visibleToDistance);
      expect(after?.status).toBe(before.status);
      expect(after?.createdAt).toEqual(before.createdAt);
    });
  });

  describe('The rename reaches the caller’s own row and no other', () => {
    it('renames only the actor it was given, leaving every other row alone', async () => {
      const repository = repositoryHolding(
        userWith(),
        userWith({ id: OTHER_USER_ID, authUserId: 'auth-user-2', handle: 'moonlight', displayName: 'Moon Light' }),
      );
      const service = createUpdateDisplayNameService({ users: repository.users });

      await service.update(USER_ID, 'Dust Storm');

      expect(repository.rowFor(OTHER_USER_ID)?.displayName).toBe('Moon Light');
    });
  });

  it('refuses rather than inventing a row when the account was erased mid-request', async () => {
    // `authenticatedProcedure` guarantees an active actor on entry, so this is only
    // reachable through the erasure race — and a service that shrugged would answer
    // "renamed" to somebody whose row is gone.
    const repository = repositoryHolding();
    const service = createUpdateDisplayNameService({ users: repository.users });

    await expect(service.update(USER_ID, 'Dust Storm')).rejects.toBeInstanceOf(
      UserRowMissingError,
    );
  });
});

import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseConnection, type DatabaseConnection } from '@playa-post/database';
import { startPostgresTestDatabase, type PostgresTestDatabase } from '@playa-post/testing';

import { createCompleteOnboardingService } from '../../application/complete-onboarding.service';
import {
  HandleCaseCollisionError,
  HandleConfusableError,
  HandleImmutableError,
} from '../../domain/user.errors';
import { createPostgresUserRepository } from '../../persistence/postgres-user.repository';

/**
 * `specs/features/identity-magic-link.feature` — the three `@integration` handle
 * scenarios that need `citext` and existing rows, so they cannot be `handle.policy`
 * unit tests (see `tests/domain/handle.policy.unit.test.ts` for the three that can).
 *
 * M2-AC25 (implementation-plan.md:394-397) — six structured codes total across both
 * suites. This file covers the three that require a database: a citext-case
 * collision, a confusable normalization, and immutability of an already-chosen
 * handle.
 *
 * Per escalation E5 ("no handle-availability endpoint — a taken handle returns a
 * generic 'not available' on submit", m2-lane-briefs.md:417-418): the case-collision
 * and confusable scenarios both describe an already-taken handle, and this suite
 * asserts their **messages are identical and generic** — indistinguishable, the same
 * way the auth boundary's 401s are (`trpc.unit.test.ts`, "says exactly the same
 * thing to 'no token' and 'bad token'"). Their **codes** are still distinct
 * (`HANDLE_CASE_COLLISION` / `HANDLE_CONFUSABLE`), which is what lets this suite and
 * `handle.policy.unit.test.ts` together produce six distinct codes for M2-AC25's
 * evidence. This is a resolved ambiguity — the ADR does not say codes must also be
 * indistinguishable, only that submitting a taken handle answers "not available" —
 * flagged explicitly in the handoff report for review.
 */
describe('handle uniqueness against a real app.users (ADR-0008:50-57 rules 4-5, M2-AC25)', () => {
  let testDatabase: PostgresTestDatabase;
  let database: DatabaseConnection;
  let completeOnboarding: ReturnType<typeof createCompleteOnboardingService>;

  beforeAll(async () => {
    testDatabase = await startPostgresTestDatabase();
    await testDatabase.client.query(`alter role app_rw with password 'app_rw_in_a_throwaway_container'`);
    database = createDatabaseConnection({
      connectionString: asRole(
        testDatabase.connectionString,
        'app_rw',
        'app_rw_in_a_throwaway_container',
      ),
    });
    // The service takes the `UserRepository` port, not a database handle:
    // `no-domain-to-infrastructure` forbids `application/` importing `persistence/`,
    // so the adapter is built here exactly as `identity.module.ts` builds it for the
    // container. Everything below still runs against real SQL and real `citext`.
    completeOnboarding = createCompleteOnboardingService({
      users: createPostgresUserRepository({ database }),
    });
  }, 300_000);

  afterEach(async () => {
    await testDatabase.truncateAllTables();
  });

  afterAll(async () => {
    await database?.destroy();
    await testDatabase?.stop();
  });

  describe('Handle differing only by case from an existing handle is rejected', () => {
    it('rejects "DustStorm" with HANDLE_CASE_COLLISION when "duststorm" already exists', async () => {
      await completeOnboarding.complete({
        authUserId: randomUUID(),
        handle: 'duststorm',
        displayName: 'Dust Storm',
      });

      await expect(
        completeOnboarding.complete({
          authUserId: randomUUID(),
          handle: 'DustStorm',
          displayName: 'Someone Else',
        }),
      ).rejects.toMatchObject({ code: 'HANDLE_CASE_COLLISION' });
    });
  });

  describe('Confusable of an existing handle is rejected', () => {
    it('rejects "m00nlight" with HANDLE_CONFUSABLE when "moonlight" already exists', async () => {
      await completeOnboarding.complete({
        authUserId: randomUUID(),
        handle: 'moonlight',
        displayName: 'Moon Light',
      });

      await expect(
        completeOnboarding.complete({
          authUserId: randomUUID(),
          // digit-for-letter confusable substitution (0 for o) — see handoff report:
          // ADR-0008 names "a confusable-normalization check" without specifying the
          // algorithm, so this is the resolved test case, not a spec quote.
          handle: 'm00nlight',
          displayName: 'Someone Else',
        }),
      ).rejects.toMatchObject({ code: 'HANDLE_CONFUSABLE' });
    });
  });

  it('answers case-collision and confusable with the identical generic message (E5 — no existence oracle)', async () => {
    await completeOnboarding.complete({
      authUserId: randomUUID(),
      handle: 'duststorm',
      displayName: 'Dust Storm',
    });
    await completeOnboarding.complete({
      authUserId: randomUUID(),
      handle: 'moonlight',
      displayName: 'Moon Light',
    });

    const caseCollision = await rejectionFrom(
      completeOnboarding.complete({
        authUserId: randomUUID(),
        handle: 'DustStorm',
        displayName: 'Someone Else',
      }),
    );
    const confusable = await rejectionFrom(
      completeOnboarding.complete({
        authUserId: randomUUID(),
        handle: 'm00nlight',
        displayName: 'Someone Else',
      }),
    );

    expect(caseCollision).toBeInstanceOf(HandleCaseCollisionError);
    expect(confusable).toBeInstanceOf(HandleConfusableError);
    expect(caseCollision.message).toBe(confusable.message);
  });

  describe('Changing an already-chosen handle is rejected', () => {
    it('rejects a second onboarding call for the same actor with code HANDLE_IMMUTABLE', async () => {
      const authUserId = randomUUID();
      await completeOnboarding.complete({
        authUserId,
        handle: 'duststorm',
        displayName: 'Dust Storm',
      });

      await expect(
        completeOnboarding.complete({
          authUserId,
          handle: 'newhandle',
          displayName: 'Dust Storm',
        }),
      ).rejects.toMatchObject({ code: 'HANDLE_IMMUTABLE' });
    });

    it('rejects with HandleImmutableError specifically, not a generic failure', async () => {
      const authUserId = randomUUID();
      await completeOnboarding.complete({
        authUserId,
        handle: 'duststorm',
        displayName: 'Dust Storm',
      });

      const rejection = await rejectionFrom(
        completeOnboarding.complete({
          authUserId,
          handle: 'newhandle',
          displayName: 'Dust Storm',
        }),
      );

      expect(rejection).toBeInstanceOf(HandleImmutableError);
    });
  });
});

async function rejectionFrom<T>(promise: Promise<T>): Promise<Error & { code?: string }> {
  try {
    await promise;
  } catch (error) {
    return error as Error & { code?: string };
  }
  throw new Error('expected the onboarding call to reject, but it resolved');
}

/** Mirrors `packages/database/src/database-schema.integration.test.ts`'s helper. */
function asRole(connectionString: string, username: string, password: string): string {
  const url = new URL(connectionString);
  url.username = username;
  url.password = password;
  return url.toString();
}

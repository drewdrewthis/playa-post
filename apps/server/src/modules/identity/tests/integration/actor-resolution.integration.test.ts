import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseConnection, type DatabaseConnection } from '@playa-post/database';
import { createLogger } from '@playa-post/observability';
import {
  generateSupabaseSigningKeyPair,
  mintSupabaseAsymmetricUserToken,
  startPostgresTestDatabase,
  type PostgresTestDatabase,
  type SupabaseSigningKeyPair,
} from '@playa-post/testing';

import { authenticateRequest } from '../../../../shared/auth/authenticate-request';
import { createSupabaseJwtVerifier } from '../../../../shared/auth/supabase-jwt-verifier';
import type { RequestContext } from '../../../../shared/trpc/request-context';
import { authenticatedProcedure, createCallerFactory, router } from '../../../../shared/trpc/trpc';
import { createResolveActorQuery } from '../../application/resolve-actor.query';
import { createPostgresUserRepository } from '../../persistence/postgres-user.repository';

/**
 * `specs/features/identity-magic-link.feature` — the three `@integration` auth-
 * boundary scenarios, M2-AC2, against a REAL `app.users` table.
 *
 * ADR-0011 rows 3-4: this is the L1 suite that produces the three outcomes and
 * retires `createNoOnboardedUsersResolver` — this file exercises
 * `modules/identity/application/resolve-actor.query.ts`, the `ActorResolver`
 * that replaces it, wired against a real Postgres.
 *
 * `apps/server/src/shared/trpc/trpc.unit.test.ts` already proves
 * `authenticatedProcedure`'s three-outcome switch against a hand-built
 * `AuthenticationOutcome` — that is a `@unit` test of the middleware. This suite is
 * the `@integration` counterpart the feature file actually names: it drives the same
 * middleware through `authenticateRequest` with a **real** `AccessTokenVerifier`
 * (ES256 against an in-process key pair, per ADR-0011) and a **real**
 * `ActorResolver` reading `app.users` from Testcontainers Postgres — nothing here is
 * a hand-built `AuthenticationOutcome`.
 */

const probeRouter = router({
  guarded: authenticatedProcedure.query(({ ctx }) => ({ userId: ctx.actor.userId })),
});
const createCaller = createCallerFactory(probeRouter);

function contextFor(
  authorizationHeader: string | undefined,
  dependencies: Parameters<typeof authenticateRequest>[1],
): RequestContext {
  // Lazy and memoised, exactly as `composition/request-scope.ts` builds it: a
  // procedure asks, and only then is the token verified and `app.users` read.
  let outcome: ReturnType<typeof authenticateRequest> | undefined;

  return {
    correlationId: 'correlation-id-for-test',
    logger: createLogger({ level: 'silent' }),
    authentication: () => (outcome ??= authenticateRequest(authorizationHeader, dependencies)),
  };
}

describe('actor resolution over a real app.users (M2-AC2, ADR-0011 rows 3-4)', () => {
  let testDatabase: PostgresTestDatabase;
  let database: DatabaseConnection;
  let signingKey: SupabaseSigningKeyPair;
  let dependencies: Parameters<typeof authenticateRequest>[1];

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
    signingKey = await generateSupabaseSigningKeyPair();
    dependencies = {
      accessTokenVerifier: createSupabaseJwtVerifier({ keySource: signingKey.publicKey }),
      // The port L1 implements: reads app.users, returns null for anyone not
      // onboarded, resolves an Actor for anyone who is (ADR-0008 rule 8).
      //
      // Takes the `UserRepository` port rather than a database handle —
      // `no-domain-to-infrastructure` forbids `application/` importing
      // `persistence/`, so the adapter is built here the same way
      // `identity.module.ts` builds it for the container.
      actorResolver: createResolveActorQuery({
        users: createPostgresUserRepository({ database }),
      }),
    };
  }, 300_000);

  afterEach(async () => {
    await testDatabase.truncateAllTables();
  });

  afterAll(async () => {
    await database?.destroy();
    await testDatabase?.stop();
  });

  describe('Request with no bearer token is unauthorized', () => {
    it('answers HTTP 401 (UNAUTHORIZED) when no bearer token is presented', async () => {
      const context = contextFor(undefined, dependencies);
      const caller = createCaller(context);

      await expect(caller.guarded()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    });
  });

  describe('Request with a tampered token is unauthorized', () => {
    it('answers HTTP 401 (UNAUTHORIZED) when the token signature has been altered', async () => {
      const token = await mintSupabaseAsymmetricUserToken({ signingKey, role: 'authenticated' });
      const tampered = withTamperedSignature(token);

      // The guard that catches a tamper which did not tamper. A token whose signature
      // decodes to the same bytes is simply a valid token: it verifies, reaches the
      // onboarding check, and answers 403 — so this scenario would report a *failure
      // of the auth boundary* when the only thing broken was its own fixture.
      expect(signatureBytesOf(tampered).equals(signatureBytesOf(token))).toBe(false);

      const context = contextFor(`Bearer ${tampered}`, dependencies);
      const caller = createCaller(context);

      await expect(caller.guarded()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    });
  });

  describe('Valid token with incomplete onboarding is blocked from the slice', () => {
    it('answers HTTP 403 with code ONBOARDING_REQUIRED for a valid token with no app.users row', async () => {
      const token = await mintSupabaseAsymmetricUserToken({ signingKey, role: 'authenticated' });

      const context = contextFor(`Bearer ${token}`, dependencies);
      const caller = createCaller(context);

      await expect(caller.guarded()).rejects.toMatchObject({
        code: 'FORBIDDEN',
        cause: expect.objectContaining({ code: 'ONBOARDING_REQUIRED' }),
      });
    });
  });

  describe('a valid token for an onboarded actor', () => {
    it('resolves the request to that actor’s app.users.id — the positive case the three refusals guard', async () => {
      const authUserId = randomUUID();
      // Seeded with the superuser test client (raw SQL) rather than through the
      // production `ActorResolver`/repository — this row is a fixture, and seeding
      // it through the port under test would make the assertion circular.
      const { rows } = await testDatabase.client.query<{ id: string }>(
        `insert into app.users (auth_user_id, handle, display_name, created_at)
         values ($1, $2, $3, now()) returning id`,
        [authUserId, 'dusty_onboarded', 'Dusty Onboarded'],
      );
      const insertedUserId = rows[0]?.id;

      const token = await mintSupabaseAsymmetricUserToken({
        signingKey,
        role: 'authenticated',
        subject: authUserId,
      });

      const context = contextFor(`Bearer ${token}`, dependencies);
      const caller = createCaller(context);

      await expect(caller.guarded()).resolves.toEqual({ userId: insertedUserId });
    });
  });
});

/** The raw signature bytes of a JWS, after base64url decoding. */
function signatureBytesOf(token: string): Buffer {
  return Buffer.from(token.split('.')[2] ?? '', 'base64url');
}

/**
 * Alter a token's signature so it no longer matches `header.payload`.
 *
 * ⚠ **Never the final character**, which is what this suite originally flipped.
 *
 * An ES256 signature is 64 bytes — 512 bits — which base64url encodes as 86
 * characters. The first 85 carry 510 bits, so the 86th carries only **2 meaningful
 * bits**; its remaining 4 are padding every decoder discards. `A` (0) and `B` (1)
 * differ only in those discarded bits and therefore decode to **identical** signature
 * bytes, and a real ES256 signature's final character is always one of `A`, `Q`, `g`,
 * `w` for the same reason. Flipping `A`→`B` was consequently a no-op: the token still
 * verified, sailed past the auth boundary, and answered 403 `ONBOARDING_REQUIRED`
 * instead of the 401 this scenario asserts.
 *
 * Measured against this project's own verifier: **76 of 300 tokens (25.3%) survived
 * that tamper, and every survivor ended in `A`** — a one-in-four flake that looked
 * like an authentication defect. The same 300 tokens tampered at a middle character,
 * where all six bits are in play: 0 survivors.
 */
function withTamperedSignature(token: string): string {
  const [header, payload, signature] = token.split('.');
  if (header === undefined || payload === undefined || signature === undefined) {
    throw new Error(`expected a three-segment JWS, received ${String(token.split('.').length)}`);
  }

  const at = Math.floor(signature.length / 2);
  const replacement = signature[at] === 'A' ? 'B' : 'A';

  return [header, payload, `${signature.slice(0, at)}${replacement}${signature.slice(at + 1)}`].join(
    '.',
  );
}

/** Mirrors `packages/database/src/database-schema.integration.test.ts`'s helper. */
function asRole(connectionString: string, username: string, password: string): string {
  const url = new URL(connectionString);
  url.username = username;
  url.password = password;
  return url.toString();
}

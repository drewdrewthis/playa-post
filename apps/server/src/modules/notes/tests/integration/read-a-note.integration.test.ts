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
import { createCallerFactory, router } from '../../../../shared/trpc/trpc';
import { createIdentityModule } from '../../../identity/identity.module';
import { createNotesModule, type NotesModule } from '../../notes.module';

/**
 * `specs/features/pin-a-note.feature` (issue #176, decision D14) — the expanded view's
 * backing read, `notes.getById`.
 *
 * Every scenario is API-level, through the real router and the real `app_rw` connection,
 * for the reason `pin-a-note.integration.test.ts` gives: the thing under test is an
 * **authorization** rule that lives in SQL. `app.visible_notes` gates on
 * `recipient_id = viewer_id`, so a suite that stubbed the repository would be asserting
 * against the one component that does not exist in production.
 *
 * ⚠ **The refusals are compared to each other, not merely observed.** "Refused" and
 * "refused indistinguishably" are different claims, and only the second one is the
 * security property — B17, asserted from `tests/security/` as well, because a B-row must
 * be provable there without reading a module's own tree.
 *
 * ⚠ **This suite reads and never writes.** Decision D14 added a procedure, not a
 * lifecycle: there is still no unpin, no archive, and no update, so there is no
 * post-read state for any scenario here to assert about.
 */
describe('read a note (pin-a-note.feature, #176)', () => {
  let testDatabase: PostgresTestDatabase;
  let database: DatabaseConnection;
  let signingKey: SupabaseSigningKeyPair;

  beforeAll(async () => {
    testDatabase = await startPostgresTestDatabase();
    await testDatabase.client.query(`alter role app_rw with password 'app_rw_in_a_throwaway_container'`);
    database = createDatabaseConnection({
      connectionString: asRole(testDatabase.connectionString, 'app_rw', 'app_rw_in_a_throwaway_container'),
    });
    signingKey = await generateSupabaseSigningKeyPair();
  }, 300_000);

  afterEach(async () => {
    await testDatabase.truncateAllTables();
  });

  afterAll(async () => {
    await database?.destroy();
    await testDatabase?.stop();
  });

  async function seedOnboardedUser(handle: string): Promise<{ userId: string; authUserId: string }> {
    const authUserId = randomUUID();
    const { rows } = await testDatabase.client.query<{ id: string }>(
      `insert into app.users (auth_user_id, handle, display_name, created_at)
       values ($1, $2, $3, now()) returning id`,
      [authUserId, handle, handle],
    );
    const userId = rows[0]?.id;
    if (userId === undefined) {
      throw new Error('seedOnboardedUser: insert returned no row');
    }
    return { userId, authUserId };
  }

  /**
   * @param aDisclosesToB - what `userAId` grants `userBId`; `limited` is what makes
   *   `app.visible_people` withhold A's name from B (ADR-0004 decision 3).
   */
  async function seedAcceptedConnection(
    userAId: string,
    userBId: string,
    aDisclosesToB: 'full' | 'limited' = 'full',
  ): Promise<void> {
    await testDatabase.client.query(
      `insert into app.connections
         (user_a_id, user_b_id, status, a_discloses_to_b_level, b_discloses_to_a_level, created_at)
       values ($1, $2, 'accepted', $3, 'full', now())`,
      [userAId, userBId, aDisclosesToB],
    );
  }

  /** The only severance `app.connections` can express — see `pin-a-note`'s own helper. */
  async function severConnection(userAId: string, userBId: string): Promise<void> {
    await testDatabase.client.query(
      `delete from app.connections where user_a_id = $1 and user_b_id = $2`,
      [userAId, userBId],
    );
  }

  // No explicit return annotation: `ReturnType<typeof createCaller>` is the callers'
  // whole type, and writing it out through `createCallerFactory` erases the router's
  // procedure map (the bulletins harnesses type their callers the same way).
  function makeCallers() {
    const module: NotesModule = createNotesModule({ database });
    const createCaller = createCallerFactory(router({ notes: module.router }));
    const { actorResolver } = createIdentityModule({ database });
    const dependencies = {
      accessTokenVerifier: createSupabaseJwtVerifier({ keySource: signingKey.publicKey }),
      actorResolver,
    };
    return {
      callerFor: async (authUserId: string) => {
        const token = await mintSupabaseAsymmetricUserToken({
          signingKey,
          role: 'authenticated',
          subject: authUserId,
        });
        return createCaller(contextFor(`Bearer ${token}`, dependencies));
      },
    };
  }

  describe('Scenario: The recipient opens one of their own notes in full (@integration, #176)', () => {
    it('answers the same note the list carries, with the author card projected the same way', async () => {
      const userA = await seedOnboardedUser('dusty_note_open_a');
      const userB = await seedOnboardedUser('dusty_note_open_b');
      await seedAcceptedConnection(userA.userId, userB.userId);

      const { callerFor } = makeCallers();
      const callerA = await callerFor(userA.authUserId);
      const callerB = await callerFor(userB.authUserId);

      const pinned = await callerA.notes.pin({
        recipientId: userB.userId,
        body: 'Bring the good shade cloth on Tuesday.',
      });

      const opened = await callerB.notes.getById({ noteId: pinned.id });

      expect(opened.id).toBe(pinned.id);
      expect(opened.body).toBe('Bring the good shade cloth on Tuesday.');
      expect(opened.author?.userId).toBe(userA.userId);
      expect(opened.author?.displayName).toBe('dusty_note_open_a');

      // ⚠ The two reads agree field for field, which is the contract
      // `packages/contracts/src/notes.ts` states: the expanded view shows more *of* the
      // note, never more *about* it. A detail payload carrying an extra field would mean
      // the list had been withholding something — and a client that swapped this answer
      // in behind a card would then be showing two different notes.
      const [listed] = await callerB.notes.list();
      expect(opened).toEqual(listed);
    });
  });

  describe('Scenario: A note names nobody, belongs to somebody else, or was written by you — one answer (@integration, #176, B17)', () => {
    it('answers NOTE_GONE identically for a stranger, the author, and an id naming no note', async () => {
      const userA = await seedOnboardedUser('dusty_note_gone_author');
      const userB = await seedOnboardedUser('dusty_note_gone_recipient');
      const userC = await seedOnboardedUser('dusty_note_gone_stranger');
      await seedAcceptedConnection(userA.userId, userB.userId);
      // C is connected to B, so C is second-degree from A and genuinely inside A's and
      // B's visible world — exactly the person a reachability-based read would wrongly
      // admit, and exactly the person who must not open B's note.
      await seedAcceptedConnection(userB.userId, userC.userId);

      const { callerFor } = makeCallers();
      const callerA = await callerFor(userA.authUserId);
      const callerC = await callerFor(userC.authUserId);

      const pinned = await callerA.notes.pin({
        recipientId: userB.userId,
        body: 'The spare key is under the third pallet.',
      });

      /**
       * The refusal as a caller can actually observe it.
       *
       * ⚠ The "expected to be refused" throw is **after** the `catch`, not inside the
       * `try`. Inside, this function's own control-flow error would be caught and
       * reported as if it were the server's answer — and a read that wrongly *succeeded*
       * would then produce two matching objects and a green indistinguishability test.
       */
      async function refusalOf(
        caller: Awaited<ReturnType<typeof callerFor>>,
        noteId: string,
      ): Promise<{ code: string | undefined; message: string | undefined }> {
        try {
          await caller.notes.getById({ noteId });
        } catch (error) {
          const refusal = error as { code?: string; message?: string };
          return { code: refusal.code, message: refusal.message };
        }
        throw new Error(`reading ${noteId} was expected to be refused`);
      }

      const refusals = [
        // A stranger naming a real note.
        await refusalOf(callerC, pinned.id),
        // A stranger naming no note at all.
        await refusalOf(callerC, randomUUID()),
        // ⚠ The note's own author. A note is left on somebody else's board, not posted to
        // a shared one, so there is no sent list and no receipt — and this is where that
        // stops being a missing feature and becomes an enforced one.
        await refusalOf(callerA, pinned.id),
      ];

      // Byte-identical, which is the property rather than a nicety: any difference at all
      // between "not yours", "no such note" and "you wrote it" turns this endpoint into an
      // existence oracle over the most private thing the product stores (ADR-0002 §10,
      // B17). Compared pairwise against the first, so a failure names which input diverged.
      expect(refusals[1]).toEqual(refusals[0]);
      expect(refusals[2]).toEqual(refusals[0]);
      expect(refusals[0]?.code).toBe('NOT_FOUND');
    });
  });

  describe('Scenario: A malformed note id is refused without reaching the database (@integration, #176)', () => {
    it('rejects a non-UUID at the input schema rather than as a driver-level failure', async () => {
      const userB = await seedOnboardedUser('dusty_note_malformed_b');

      const { callerFor } = makeCallers();
      const callerB = await callerFor(userB.authUserId);

      // A `uuid` column would answer a malformed id with a 500 carrying a driver message.
      // The schema check exists for that wire reason alone — it is never an existence
      // check, which is why a *well-formed* id naming nothing gets `NOTE_GONE` above.
      await expect(callerB.notes.getById({ noteId: 'not-a-uuid' })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      });
    });
  });

  describe('Scenario: An opened note outlives the connection that carried it (@integration, #176)', () => {
    it('keeps the note and drops the author card entirely when the connection is severed', async () => {
      const userA = await seedOnboardedUser('dusty_note_read_severed_a');
      const userB = await seedOnboardedUser('dusty_note_read_severed_b');
      await seedAcceptedConnection(userA.userId, userB.userId);

      const { callerFor } = makeCallers();
      const callerA = await callerFor(userA.authUserId);
      const callerB = await callerFor(userB.authUserId);

      const pinned = await callerA.notes.pin({
        recipientId: userB.userId,
        body: 'The bikes are behind the kitchen.',
      });
      await severConnection(userA.userId, userB.userId);

      const opened = await callerB.notes.getById({ noteId: pinned.id });

      // The message survives the messenger, on this read exactly as on the list: the
      // LEFT JOIN in `visible-notes.sql` is composed once and both reads inherit it, so
      // the expanded view cannot be the surface where a delivered note quietly vanishes.
      expect(opened.body).toBe('The bikes are behind the kitchen.');
      expect(opened.author).toBeUndefined();
      // Absent, not null: the key is gone, so there is nothing for the sheet to render a
      // placeholder into — and nothing to offer a pin-back to, which is the client rule
      // decision D14 records.
      expect(Object.keys(opened)).not.toContain('author');
      expect(JSON.stringify(opened)).not.toContain(userA.userId);
    });
  });

  describe('Scenario: An author who discloses only limited is opened with no name (@integration, #176)', () => {
    it('carries the note and the card, and omits displayName and handle entirely', async () => {
      const userA = await seedOnboardedUser('dusty_note_read_limited_a');
      const userB = await seedOnboardedUser('dusty_note_read_limited_b');
      await seedAcceptedConnection(userA.userId, userB.userId, 'limited');

      const { callerFor } = makeCallers();
      const callerA = await callerFor(userA.authUserId);
      const callerB = await callerFor(userB.authUserId);

      const pinned = await callerA.notes.pin({
        recipientId: userB.userId,
        body: 'Coffee at sunrise, same place.',
      });

      const opened = await callerB.notes.getById({ noteId: pinned.id });

      // ⚠ §6a is evaluated on **this** read, not carried over from the list: the person is
      // still in B's world, so the card stays and only the identity columns go. That is the
      // *partial* absence, distinct from the severed-connection scenario above where there
      // is no person left to describe at all — and the reason the sheet must render
      // `PersonIdentity`'s private treatment rather than a name it remembers.
      expect(opened.body).toBe('Coffee at sunrise, same place.');
      expect(opened.author?.userId).toBe(userA.userId);
      expect(opened.author?.disclosure).toBe('topology_only');
      expect(JSON.stringify(opened.author)).not.toContain('displayName');
      expect(JSON.stringify(opened.author)).not.toContain('handle');
    });
  });
});

function contextFor(
  authorizationHeader: string | undefined,
  dependencies: Parameters<typeof authenticateRequest>[1],
): RequestContext {
  let outcome: ReturnType<typeof authenticateRequest> | undefined;
  return {
    correlationId: 'correlation-id-for-test',
    logger: createLogger({ level: 'silent' }),
    authentication: () => (outcome ??= authenticateRequest(authorizationHeader, dependencies)),
  };
}

/** Mirrors `packages/database/src/database-schema.integration.test.ts`'s helper. */
function asRole(connectionString: string, username: string, password: string): string {
  const url = new URL(connectionString);
  url.username = username;
  url.password = password;
  return url.toString();
}

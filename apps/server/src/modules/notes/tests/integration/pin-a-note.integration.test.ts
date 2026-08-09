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
// `modules/sync`'s public wiring point, for the replay scenario. Its own barrel, never
// its persistence — the `no-cross-module-persistence` rule applies to this test file
// too, the same way `offline-replay.integration.test.ts` reaches this module.
import type { MutationHandler } from '../../../sync/domain/mutation-handler';
import { createSyncModule, type SyncModule } from '../../../sync/sync.module';
import { NOTE_BODY_MAX_LENGTH } from '../../domain/note-content';
import { createNotesModule, type NotesModule } from '../../notes.module';
import { presentNote } from '../../transport/note.presenter';
import { pinNoteCommandFields, pinNoteInput } from '../../transport/pin-note.input';

/**
 * `specs/features/pin-a-note.feature` (issue #88, decision D6) — the private
 * person-to-person channel.
 *
 * Every scenario is API-level, through the real router and the real `app_rw` connection,
 * because the thing under test is an **authorization** rule that lives in SQL: the pin is
 * one `INSERT … SELECT … WHERE EXISTS` over `app.visible_people`, so a suite that stubbed
 * the repository would be asserting against the one component that does not exist in
 * production.
 *
 * ⚠ The refusal assertions check **zero rows**, not just a thrown error. "Refused" and
 * "refused without writing anything" are different claims, and only the second one says
 * the gate is inside the statement rather than in front of it.
 */
describe('pin a note (pin-a-note.feature, #88)', () => {
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

  /**
   * Remove the connection outright, which is the only severance `app.connections` can
   * express: its `status` column is documented as "accepted (M2 has no other state)", so
   * there is no `revoked` row to write instead. Whatever the withdrawal mutation
   * eventually does, it ends with this pair absent from `app.visible_people`, which is
   * the input the note read actually reacts to.
   */
  async function severConnection(userAId: string, userBId: string): Promise<void> {
    await testDatabase.client.query(
      `delete from app.connections where user_a_id = $1 and user_b_id = $2`,
      [userAId, userBId],
    );
  }

  /** ADR-0002 B11's lifecycle: `app.visible_people` prunes anyone not `active`. */
  async function deactivateUser(userId: string): Promise<void> {
    await testDatabase.client.query(
      `update app.users set status = 'deactivated', deactivated_at = now() where id = $1`,
      [userId],
    );
  }

  /** Lower what `userAId` discloses to `userBId`, after the note has already been pinned. */
  async function setDisclosure(
    userAId: string,
    userBId: string,
    aDisclosesToB: 'full' | 'limited',
  ): Promise<void> {
    await testDatabase.client.query(
      `update app.connections set a_discloses_to_b_level = $3
        where user_a_id = $1 and user_b_id = $2`,
      [userAId, userBId, aDisclosesToB],
    );
  }

  async function notesRowCount(): Promise<number> {
    const { rows } = await testDatabase.client.query<{ count: string }>(
      'select count(*)::text as count from app.notes',
    );
    return Number(rows[0]?.count ?? '0');
  }

  async function outboxRows(): Promise<
    readonly { event_type: string; actor_id: string | null; aggregate_id: string; payload: unknown }[]
  > {
    const { rows } = await testDatabase.client.query<{
      event_type: string;
      actor_id: string | null;
      aggregate_id: string;
      payload: unknown;
    }>('select event_type, actor_id, aggregate_id, payload from app.outbox_events');
    return rows;
  }

  /**
   * The idempotency store as the database holds it.
   *
   * `body_field` and `result_text` are extracted **in SQL** rather than by re-serializing
   * the driver's parsed object: the claim is about what is durably stored in the jsonb
   * column for the 30-day window (ADR-0005), and a round trip through `pg`'s type parser
   * is a claim about the driver.
   */
  async function mutationResultRows(): Promise<
    readonly { mutation_type: string; body_field: string | null; result_text: string }[]
  > {
    const { rows } = await testDatabase.client.query<{
      mutation_type: string;
      body_field: string | null;
      result_text: string;
    }>(
      `select mutation_type,
              result ->> 'body' as body_field,
              result::text      as result_text
         from app.mutation_results`,
    );
    return rows;
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

  /**
   * The `note.pin` adapter, written the way `composition/container.ts` writes it.
   *
   * Restated here rather than imported: `no-container-outside-composition` puts
   * `container.ts` out of reach of a module test, and building the adapter the same way
   * production does is what makes the replay assertion below about the real handler shape
   * rather than about a convenience stub.
   */
  function notePinHandler(notesModule: NotesModule): MutationHandler {
    return {
      async handle({ actorId, payload }) {
        const parsed = pinNoteInput.parse(payload);
        return {
          result: presentNote(
            await notesModule.pinNote.pin({ authorId: actorId, ...pinNoteCommandFields(parsed) }),
          ),
        };
      },
    };
  }

  /**
   * A caller onto the real `sync` router with `note.pin` registered — the offline path.
   *
   * Shared by the two scenarios that submit envelopes, because they differ only in what
   * they then assert: one reads the response, the other reads the row the response was
   * stored in, and both have to be looking at the same wiring for either to mean
   * anything.
   */
  async function syncCallerFor(authUserId: string) {
    const notesModule: NotesModule = createNotesModule({ database });
    const syncModule: SyncModule = createSyncModule({
      database,
      handlers: { 'note.pin': notePinHandler(notesModule) },
      // `note.pin` has no actorship check on purpose: it names no pre-existing subject,
      // and its one authorization question is settled inside the insert. Registering a
      // check here would make this suite test a gate production does not have.
      actorshipChecks: {},
    });
    const createCaller = createCallerFactory(router({ sync: syncModule.router }));
    const token = await mintSupabaseAsymmetricUserToken({
      signingKey,
      role: 'authenticated',
      subject: authUserId,
    });
    const { actorResolver } = createIdentityModule({ database });

    return createCaller(
      contextFor(`Bearer ${token}`, {
        accessTokenVerifier: createSupabaseJwtVerifier({ keySource: signingKey.publicKey }),
        actorResolver,
      }),
    );
  }

  describe("Scenario: A note reaches its recipient's board and nobody else's (@integration, #88)", () => {
    it("lands on user B's list with user A as its author, and on no other list", async () => {
      const userA = await seedOnboardedUser('dusty_note_reach_a');
      const userB = await seedOnboardedUser('dusty_note_reach_b');
      const userC = await seedOnboardedUser('dusty_note_reach_c');
      await seedAcceptedConnection(userA.userId, userB.userId);
      // C is connected to B, so C is second-degree from A and *is* in A's visible people
      // — which is exactly the person a reachability-based gate would wrongly let A write
      // to, and exactly the person who must not see B's note.
      await seedAcceptedConnection(userB.userId, userC.userId);

      const { callerFor } = makeCallers();
      const callerA = await callerFor(userA.authUserId);
      const callerB = await callerFor(userB.authUserId);
      const callerC = await callerFor(userC.authUserId);

      const pinned = await callerA.notes.pin({
        recipientId: userB.userId,
        body: 'The good coffee is in the blue bin.',
      });
      expect(pinned.recipientId).toBe(userB.userId);

      const forB = await callerB.notes.list();
      expect(forB).toHaveLength(1);
      expect(forB[0]?.id).toBe(pinned.id);
      expect(forB[0]?.body).toBe('The good coffee is in the blue bin.');
      expect(forB[0]?.author?.userId).toBe(userA.userId);
      // At `full` disclosure the projected author card carries the name.
      expect(forB[0]?.author?.displayName).toBe('dusty_note_reach_a');

      // The author does not read their own note back: a note is left on somebody else's
      // board, not posted to a shared one.
      expect(await callerA.notes.list()).toEqual([]);
      expect(await callerC.notes.list()).toEqual([]);
    });
  });

  describe('Scenario: An author who discloses only limited appears on the note with no name (@integration, #88)', () => {
    it('carries the note and omits displayName and handle entirely', async () => {
      const userA = await seedOnboardedUser('dusty_note_limited_a');
      const userB = await seedOnboardedUser('dusty_note_limited_b');
      await seedAcceptedConnection(userA.userId, userB.userId, 'limited');

      const { callerFor } = makeCallers();
      const callerA = await callerFor(userA.authUserId);
      const callerB = await callerFor(userB.authUserId);

      await callerA.notes.pin({ recipientId: userB.userId, body: 'Left you something.' });

      const forB = await callerB.notes.list();
      expect(forB).toHaveLength(1);
      // The card is *present* and unnamed — a different absence from the author-less note
      // the lifecycle scenarios below produce, and the reason `userId` is asserted here.
      expect(forB[0]?.author?.userId).toBe(userA.userId);
      expect(forB[0]?.author?.disclosure).toBe('topology_only');
      // ⚠ **Absent keys**, not nulls. ADR-0002 §6a: the columns are never projected, so a
      // serialized payload carries no identity key at all — which is what stops a client
      // rendering a placeholder where a withheld name would be.
      expect(JSON.stringify(forB[0]?.author)).not.toContain('displayName');
      expect(JSON.stringify(forB[0]?.author)).not.toContain('handle');
    });
  });

  describe('Scenario: Pinning to a second-degree person is refused and writes nothing (@integration, #88)', () => {
    it('refuses with NOTE_RECIPIENT_UNREACHABLE and leaves zero note and outbox rows', async () => {
      const userA = await seedOnboardedUser('dusty_note_second_a');
      const userB = await seedOnboardedUser('dusty_note_second_b');
      const userC = await seedOnboardedUser('dusty_note_second_c');
      await seedAcceptedConnection(userA.userId, userB.userId);
      await seedAcceptedConnection(userB.userId, userC.userId);

      const { callerFor } = makeCallers();
      const callerA = await callerFor(userA.authUserId);

      // C is *visible* to A — second degree, on A's graph — and still may not be written
      // to. Visible and connected are two different questions, and this is the scenario
      // that keeps them apart.
      await expect(
        callerA.notes.pin({ recipientId: userC.userId, body: 'Two hops away.' }),
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
        cause: expect.objectContaining({ code: 'NOTE_RECIPIENT_UNREACHABLE' }),
      });

      expect(await notesRowCount()).toBe(0);
      expect(await outboxRows()).toHaveLength(0);
    });
  });

  describe('Scenario: Pinning to a stranger is refused the same way as pinning to nobody (@integration, #88)', () => {
    it('answers identically for an unconnected person, a UUID naming nobody, and yourself', async () => {
      const userA = await seedOnboardedUser('dusty_note_stranger_a');
      const userD = await seedOnboardedUser('dusty_note_stranger_d');

      const { callerFor } = makeCallers();
      const callerA = await callerFor(userA.authUserId);

      /**
       * The refusal as a caller can actually observe it.
       *
       * ⚠ The "expected to be refused" throw is **after** the `catch`, not inside the
       * `try`. Inside, this function's own control-flow error would be caught and
       * reported as if it were the server's answer — and a pin that wrongly *succeeded*
       * would then produce two matching objects and a green indistinguishability test.
       */
      async function refusalOf(
        recipientId: string,
      ): Promise<{ code: string | undefined; message: string | undefined }> {
        try {
          await callerA.notes.pin({ recipientId, body: 'Do I know you?' });
        } catch (error) {
          const refusal = error as { code?: string; message?: string };
          return { code: refusal.code, message: refusal.message };
        }
        throw new Error(`pinning to ${recipientId} was expected to be refused`);
      }

      const refusals = [
        await refusalOf(userD.userId),
        await refusalOf(randomUUID()),
        // The third input is the caller themselves, and it needs no separate gate: nobody
        // is at degree 1 of themselves, so the same `EXISTS` that refuses a stranger
        // refuses this — the property the `notes_distinct_parties` constraint backstops
        // (asserted directly in `visible-notes-migration.integration.test.ts`).
        await refusalOf(userA.userId),
      ];

      // Byte-identical, which is the property rather than a nicety: any difference at all
      // between "not connected", "no such person" and "that is yourself" turns this
      // endpoint into a user-existence oracle in a product that has no people search
      // (ADR-0002 §10, B17). Compared pairwise against the first, so a failure names which
      // input diverged.
      expect(refusals[1]).toEqual(refusals[0]);
      expect(refusals[2]).toEqual(refusals[0]);
      expect(refusals[0]?.code).toBe('NOT_FOUND');
      expect(await notesRowCount()).toBe(0);
    });
  });

  describe('Scenario: An empty or over-long note is refused naming the body (@integration, #88)', () => {
    it('refuses whitespace-only and over-long bodies with NOTE_CONTENT_INVALID and writes no row', async () => {
      const userA = await seedOnboardedUser('dusty_note_content_a');
      const userB = await seedOnboardedUser('dusty_note_content_b');
      await seedAcceptedConnection(userA.userId, userB.userId);

      const { callerFor } = makeCallers();
      const callerA = await callerFor(userA.authUserId);

      for (const body of ['   ', 'x'.repeat(NOTE_BODY_MAX_LENGTH + 1)]) {
        await expect(callerA.notes.pin({ recipientId: userB.userId, body })).rejects.toMatchObject({
          // BAD_REQUEST, not NOT_FOUND: the caller's own submission is malformed, and
          // saying so discloses nothing. The stable code is what a client branches on.
          code: 'BAD_REQUEST',
          cause: expect.objectContaining({ code: 'NOTE_CONTENT_INVALID' }),
        });
      }

      expect(await notesRowCount()).toBe(0);
    });
  });

  describe('Scenario: Replaying the same note.pin envelope through sync writes one note (@integration, #88, ADR-0005)', () => {
    it('applies once, replays with the identical result, and leaves exactly one note', async () => {
      const userA = await seedOnboardedUser('dusty_note_replay_a');
      const userB = await seedOnboardedUser('dusty_note_replay_b');
      await seedAcceptedConnection(userA.userId, userB.userId);

      const callerA = await syncCallerFor(userA.authUserId);

      const envelope = {
        mutationId: randomUUID(),
        mutationType: 'note.pin',
        clientCreatedAt: new Date().toISOString(),
        payload: { recipientId: userB.userId, body: 'Queued while the radio was off.' },
      };

      const first = await callerA.sync.submitMutations({ mutations: [envelope] });
      const second = await callerA.sync.submitMutations({ mutations: [envelope] });

      expect(first.results[0]?.outcome).toBe('applied');
      expect(second.results[0]?.outcome).toBe('replayed');
      expect(second.results[0]?.result).toEqual(first.results[0]?.result);
      expect(await notesRowCount()).toBe(1);
    });
  });

  describe("Scenario: The idempotency store keeps no copy of a pinned note's text (@integration, #88, ADR-0005)", () => {
    it('stores a result with no body field and no note text in the jsonb at all', async () => {
      const userA = await seedOnboardedUser('dusty_note_idem_a');
      const userB = await seedOnboardedUser('dusty_note_idem_b');
      await seedAcceptedConnection(userA.userId, userB.userId);

      const callerA = await syncCallerFor(userA.authUserId);

      const distinctivePhrase = 'obsidian-marigold-thunderhead';
      const response = await callerA.sync.submitMutations({
        mutations: [
          {
            mutationId: randomUUID(),
            mutationType: 'note.pin',
            clientCreatedAt: new Date().toISOString(),
            payload: { recipientId: userB.userId, body: `Meet me by the ${distinctivePhrase}.` },
          },
        ],
      });

      expect(response.results[0]?.outcome).toBe('applied');
      expect(await notesRowCount()).toBe(1);

      const stored = await mutationResultRows();
      expect(stored).toHaveLength(1);
      expect(stored[0]?.mutation_type).toBe('note.pin');

      // ⚠ The whole stored value, not just the absence of the key it would live under.
      // `app.mutation_results.result` is jsonb held for the 30-day replay window and
      // returned verbatim on every replay, in a row guarded by no recipient predicate —
      // so text that reached it would be a second, ungated copy of the most private thing
      // this product stores, exactly the copy decision D6 and PDF §6 rule out. The one
      // copy lives in `app.notes` and is reachable only through `app.visible_notes`.
      expect(stored[0]?.body_field).toBeNull();
      expect(stored[0]?.result_text).not.toContain(distinctivePhrase);

      // The same value is what a replaying client is handed back, so the response carries
      // no more than the row does.
      expect(JSON.stringify(response.results[0]?.result)).not.toContain(distinctivePhrase);
    });
  });

  describe('Scenario: The outbox event for a pinned note carries identifiers only (@integration, #88, ADR-0006)', () => {
    it('writes one NotePinned row whose payload is three IDs and no text', async () => {
      const userA = await seedOnboardedUser('dusty_note_outbox_a');
      const userB = await seedOnboardedUser('dusty_note_outbox_b');
      await seedAcceptedConnection(userA.userId, userB.userId);

      const { callerFor } = makeCallers();
      const callerA = await callerFor(userA.authUserId);

      const distinctivePhrase = 'sagebrush-lantern-quicksilver';
      const pinned = await callerA.notes.pin({
        recipientId: userB.userId,
        body: `Remember the ${distinctivePhrase}.`,
      });

      const events = await outboxRows();
      expect(events).toHaveLength(1);
      expect(events[0]?.event_type).toBe('NotePinned');
      expect(events[0]?.actor_id).toBe(userA.userId);
      expect(events[0]?.aggregate_id).toBe(pinned.id);
      expect(events[0]?.payload).toEqual({
        noteId: pinned.id,
        authorId: userA.userId,
        recipientId: userB.userId,
      });

      // ⚠ The whole row, not just the payload. An outbox row is durable and widely read,
      // and a note is the most private thing this product stores — a consumer re-reads it
      // through `app.visible_notes` or it does not get it at all (M2-AC16, PDF §6).
      expect(JSON.stringify(events[0])).not.toContain(distinctivePhrase);
    });
  });

  /**
   * The post-delivery lifecycle — what happens to a note when the *relationship* changes.
   *
   * ⚠ The invariant all three share: **the card may go, the message may not.** A note was
   * addressed to one person and delivered, so it is theirs; nothing a third party does to
   * their own connection or their own account may reach onto somebody else's board and
   * remove what they were told. This is where notes deliberately diverge from bulletins,
   * which are published outward and rightly leave with their author.
   *
   * ⚠ And the half that keeps the divergence safe: when the author card goes, it goes
   * **whole**. Each scenario asserts the author's `app.users.id` is nowhere in the
   * serialized note, because `app.visible_notes` projects every author column from the
   * authorized set — so a person the graph has excluded cannot leak back as a bare
   * identifier on a note they once wrote.
   */
  describe('Scenario: A delivered note outlives the connection that carried it (@integration, #88)', () => {
    it('keeps the note and drops the author card entirely when the connection is severed', async () => {
      const userA = await seedOnboardedUser('dusty_note_severed_a');
      const userB = await seedOnboardedUser('dusty_note_severed_b');
      await seedAcceptedConnection(userA.userId, userB.userId);

      const { callerFor } = makeCallers();
      const callerA = await callerFor(userA.authUserId);
      const callerB = await callerFor(userB.authUserId);

      await callerA.notes.pin({ recipientId: userB.userId, body: 'The spare goggles are yours.' });
      await severConnection(userA.userId, userB.userId);

      const forB = await callerB.notes.list();
      expect(forB).toHaveLength(1);
      expect(forB[0]?.body).toBe('The spare goggles are yours.');
      expect(forB[0]?.author).toBeUndefined();
      // Absent, not null: the key is gone, so there is nothing for a client to render a
      // placeholder into (the same discipline the identity fields inside a card follow).
      expect(Object.keys(forB[0] ?? {})).not.toContain('author');
      expect(JSON.stringify(forB[0])).not.toContain(userA.userId);
    });
  });

  describe('Scenario: A delivered note outlives its author deactivating (@integration, #88, B11)', () => {
    it('keeps the note and drops the author card entirely when the author is no longer active', async () => {
      const userA = await seedOnboardedUser('dusty_note_gone_a');
      const userB = await seedOnboardedUser('dusty_note_gone_b');
      await seedAcceptedConnection(userA.userId, userB.userId);

      const { callerFor } = makeCallers();
      const callerA = await callerFor(userA.authUserId);
      const callerB = await callerFor(userB.authUserId);

      await callerA.notes.pin({ recipientId: userB.userId, body: 'Water is under the shade structure.' });
      await deactivateUser(userA.userId);

      const forB = await callerB.notes.list();
      expect(forB).toHaveLength(1);
      expect(forB[0]?.body).toBe('Water is under the shade structure.');
      expect(forB[0]?.author).toBeUndefined();
      expect(JSON.stringify(forB[0])).not.toContain(userA.userId);
    });
  });

  describe('Scenario: An author who lowers their disclosure after pinning keeps the note and loses the name (@integration, #88)', () => {
    it('projects the card at read time, so the name disappears and the note does not', async () => {
      const userA = await seedOnboardedUser('dusty_note_lowered_a');
      const userB = await seedOnboardedUser('dusty_note_lowered_b');
      await seedAcceptedConnection(userA.userId, userB.userId, 'full');

      const { callerFor } = makeCallers();
      const callerA = await callerFor(userA.authUserId);
      const callerB = await callerFor(userB.authUserId);

      await callerA.notes.pin({ recipientId: userB.userId, body: 'Left the lantern by your door.' });
      // Named at pin time, unnamed afterwards — which is the point: §6a is evaluated on
      // every read, so the card is never a snapshot of what was disclosed when the note
      // was written.
      expect((await callerB.notes.list())[0]?.author?.displayName).toBe('dusty_note_lowered_a');

      await setDisclosure(userA.userId, userB.userId, 'limited');

      const forB = await callerB.notes.list();
      expect(forB).toHaveLength(1);
      expect(forB[0]?.body).toBe('Left the lantern by your door.');
      // The person is still in B's world, so the card stays — it is only the identity
      // columns that go. This is the *partial* absence, distinct from the two scenarios
      // above where there is no person left to describe at all.
      expect(forB[0]?.author?.userId).toBe(userA.userId);
      expect(forB[0]?.author?.disclosure).toBe('topology_only');
      expect(JSON.stringify(forB[0]?.author)).not.toContain('displayName');
      expect(JSON.stringify(forB[0]?.author)).not.toContain('handle');
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

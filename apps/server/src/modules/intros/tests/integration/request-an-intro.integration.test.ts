import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseConnection, type DatabaseConnection } from '@playa-post/database';
import { createLogger, type Logger } from '@playa-post/observability';
import {
  generateSupabaseSigningKeyPair,
  mintSupabaseAsymmetricUserToken,
  startPostgresTestDatabase,
  type PostgresTestDatabase,
  type SupabaseSigningKeyPair,
} from '@playa-post/testing';

import type { OutboxConsumer } from '../../../../entrypoints/outbox-drainer/outbox-consumer';
import { authenticateRequest } from '../../../../shared/auth/authenticate-request';
import { createSupabaseJwtVerifier } from '../../../../shared/auth/supabase-jwt-verifier';
import type { RequestContext } from '../../../../shared/trpc/request-context';
import { createCallerFactory, router } from '../../../../shared/trpc/trpc';
import { createConnectionsModule } from '../../../connections/connections.module';
import { createIdentityModule } from '../../../identity/identity.module';
import { INTRO_NOTE_MAX_LENGTH } from '../../domain/intro-note';
import { createIntrosModule, type IntrosModule } from '../../intros.module';

/**
 * `specs/features/request-an-intro.feature` (issue #89) — the one-hop introduction.
 *
 * Every scenario is API-level, through the real router and the real `app_rw` connection,
 * because the thing under test is an **authorization** rule that lives in SQL: eligibility
 * is one `WHERE EXISTS` inside the insert and one more inside the pass-on update, so a
 * suite that stubbed the repository would be asserting against the one component that
 * does not exist in production.
 *
 * ⚠ Three assertion shapes carry most of the weight, and none of them is "an error was
 * thrown":
 *
 * 1. **Zero rows and zero events.** "Refused" and "refused without writing anything" are
 *    different claims, and only the second says the gate is inside the statement.
 * 2. **A one-element Set.** Seven refusals are serialized and de-duplicated; anything but
 *    one element means the endpoint distinguishes cases and has become a user-existence
 *    oracle (ADR-0002 §10, B17).
 * 3. **Deep equality against a control user standing in the same graph position.** A
 *    target must not be able to tell "declined" from "never asked", and the honest way to
 *    say that is `toEqual` against somebody for whom nothing ever happened — not an
 *    absent-field check, which goes green the day a field is renamed.
 *
 * Issue #175 added the fourth shape rather than a fourth suite: **two distinctive
 * phrases**, one per note, so every "the text never reaches here" assertion has to hold
 * for the via's vouch as well as the requester's ask.
 *
 * Issue #166 adds the fifth, and it spans two modules on purpose: **the connection row
 * itself**. Accepting an introduction is what forms it, through the `IntroAccepted` outbox
 * event and `modules/connections`' own consumer (decision D12) — so "accepted" and
 * "connected" are two different claims and the scenarios below assert the second one, by
 * delivering the event the way the drainer does and then reading `app.connections`. A
 * suite that stopped at the status would go green against a seam that was never wired.
 */
describe('request an intro (request-an-intro.feature, #89, #175 and #166)', () => {
  let testDatabase: PostgresTestDatabase;
  let database: DatabaseConnection;
  let signingKey: SupabaseSigningKeyPair;

  /** Distinctive enough that finding it anywhere is evidence rather than coincidence. */
  const DISTINCTIVE_PHRASE = 'obsidian-marigold-thunderhead';
  const NOTE = `We should talk about the ${DISTINCTIVE_PHRASE}.`;

  /**
   * The via's own note and its own phrase (issue #175).
   *
   * ⚠ **Two phrases, because the row now carries two notes by two people.** Every
   * "the note never reaches here" assertion has to name both: an outbox payload or a log
   * line that dropped the requester's ask and kept the via's vouch would satisfy the
   * one-phrase version of those checks forever.
   */
  const DISTINCTIVE_VIA_PHRASE = 'cinnabar-lantern-switchback';
  const VIA_NOTE = `Worth an hour of yours — the ${DISTINCTIVE_VIA_PHRASE}.`;

  /**
   * A pass-on, with the note #175 requires on it.
   *
   * A helper rather than an inline literal at fifteen call sites, and `as const` is
   * load-bearing: `intros.decide` takes a discriminated union, so outside an argument
   * position `decision` widens to `string` and the object matches neither arm.
   */
  const passOn = (introRequestId: string) =>
    ({ introRequestId, decision: 'pass_on', note: VIA_NOTE }) as const;

  beforeAll(async () => {
    testDatabase = await startPostgresTestDatabase();
    await testDatabase.client.query(
      `alter role app_rw with password 'app_rw_in_a_throwaway_container'`,
    );
    database = createDatabaseConnection({
      connectionString: asRole(
        testDatabase.connectionString,
        'app_rw',
        'app_rw_in_a_throwaway_container',
      ),
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

  interface SeededUser {
    readonly userId: string;
    readonly authUserId: string;
    readonly handle: string;
  }

  async function seedOnboardedUser(handle: string): Promise<SeededUser> {
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
    return { userId, authUserId, handle };
  }

  async function connect(userAId: string, userBId: string): Promise<void> {
    await testDatabase.client.query(
      `insert into app.connections
         (user_a_id, user_b_id, status, a_discloses_to_b_level, b_discloses_to_a_level, created_at)
       values ($1, $2, 'accepted', 'full', 'full', now())`,
      [userAId, userBId],
    );
  }

  async function sever(userAId: string, userBId: string): Promise<void> {
    await testDatabase.client.query(
      `delete from app.connections
        where (user_a_id = $1 and user_b_id = $2) or (user_a_id = $2 and user_b_id = $1)`,
      [userAId, userBId],
    );
  }

  async function setReach(
    userId: string,
    distance: 'first' | 'second' | 'third' | 'sixth',
  ): Promise<void> {
    await testDatabase.client.query(
      `update app.users set visible_to_distance = $2 where id = $1`,
      [userId, distance],
    );
  }

  async function deactivate(userId: string): Promise<void> {
    await testDatabase.client.query(
      `update app.users set status = 'deactivated', deactivated_at = now() where id = $1`,
      [userId],
    );
  }

  interface StoredIntroRequest {
    readonly id: string;
    readonly requester_id: string;
    readonly via_id: string;
    readonly target_id: string;
    readonly note: string;
    readonly via_note: string | null;
    readonly status: string;
    readonly decided_at: Date | null;
    readonly responded_at: Date | null;
  }

  async function introRequestRows(): Promise<readonly StoredIntroRequest[]> {
    const { rows } = await testDatabase.client.query<StoredIntroRequest>(
      `select id, requester_id, via_id, target_id, note, via_note, status,
              decided_at, responded_at
         from app.intro_requests order by created_at, id`,
    );
    return rows;
  }

  interface StoredConnection {
    readonly user_a_id: string;
    readonly user_b_id: string;
    readonly status: string;
    readonly a_discloses_to_b_level: string;
    readonly b_discloses_to_a_level: string;
    readonly created_at: Date;
  }

  /**
   * The stored connection between two people, in whichever order it was written.
   *
   * Scoped to a pair rather than reading the whole table, because `seedSymmetricWorld`
   * lays down four connections of its own: a bare `app.connections` count would be
   * measuring the fixture. The **order-agnostic** match matters too — the application
   * writes the pair in lexical order, so asserting one order would pass or fail on where
   * two random UUIDs happened to sort.
   */
  async function connectionsBetween(
    oneUserId: string,
    otherUserId: string,
  ): Promise<readonly StoredConnection[]> {
    const { rows } = await testDatabase.client.query<StoredConnection>(
      `select user_a_id, user_b_id, status,
              a_discloses_to_b_level, b_discloses_to_a_level, created_at
         from app.connections
        where (user_a_id = $1 and user_b_id = $2) or (user_a_id = $2 and user_b_id = $1)`,
      [oneUserId, otherUserId],
    );
    return rows;
  }

  /** How many connections exist at all — for "and nowhere else either". */
  async function connectionCount(): Promise<number> {
    const { rows } = await testDatabase.client.query<{ count: string }>(
      'select count(*)::text as count from app.connections',
    );
    return Number(rows[0]?.count ?? '-1');
  }

  /**
   * Hand every stored outbox row to a consumer, exactly as the drainer would (#166).
   *
   * ⚠ **This is the half of the feature that lives in another module**, and delivering it
   * by hand here rather than asserting a connection appeared by itself is deliberate: the
   * seam is an at-least-once delivery, so a suite that waited on the real poller would be
   * timing-dependent, and one that skipped delivery entirely would prove nothing about
   * decision D12. The real *registration* — that `buildAppContainer` gives this consumer to
   * the drainer at all — is `composition/container-notification-wiring.integration.test.ts`'s
   * job, and nothing here can substitute for it.
   *
   * Every row is offered, not just the interesting one: a consumer must be a no-op for the
   * event types it does not subscribe to, and offering it only `IntroAccepted` would never
   * discover that it had started acting on `IntroTargetDeclined`.
   */
  async function deliverEveryEventTo(consumer: OutboxConsumer): Promise<void> {
    const { rows } = await testDatabase.client.query<{
      event_id: string;
      event_type: string;
      occurred_at: Date;
      actor_id: string | null;
      aggregate_id: string;
      payload: Record<string, unknown>;
      attempts: number;
    }>(
      `select event_id, event_type, occurred_at, actor_id, aggregate_id, payload, attempts
         from app.outbox_events order by occurred_at, event_id`,
    );

    for (const row of rows) {
      await consumer.handle({
        eventId: row.event_id,
        eventType: row.event_type,
        occurredAt: row.occurred_at,
        actorId: row.actor_id,
        aggregateId: row.aggregate_id,
        payload: row.payload,
        attempts: row.attempts,
      });
    }
  }

  /** `modules/connections`' `IntroAccepted` consumer — the other end of decision D12. */
  function introducedPairConsumer(): OutboxConsumer {
    return createConnectionsModule({ database }).connectIntroducedPair;
  }

  async function outboxRows(): Promise<
    readonly {
      event_type: string;
      actor_id: string | null;
      aggregate_id: string;
      payload: unknown;
    }[]
  > {
    const { rows } = await testDatabase.client.query<{
      event_type: string;
      actor_id: string | null;
      aggregate_id: string;
      payload: unknown;
    }>('select event_type, actor_id, aggregate_id, payload from app.outbox_events');
    return rows;
  }

  /** Captured pino lines, and the logger that writes them. */
  function capturingLogger(): { readonly logger: Logger; readonly lines: string[] } {
    const lines: string[] = [];
    const logger = createLogger(
      { level: 'trace' },
      {
        write(line: string): void {
          lines.push(line);
        },
      },
    );
    return { logger, lines };
  }

  // No explicit return annotation: `ReturnType<typeof createCaller>` is the callers'
  // whole type, and writing it out through `createCallerFactory` erases the router's
  // procedure map (the notes and bulletins harnesses type their callers the same way).
  function makeCallers(logger?: Logger) {
    const module: IntrosModule = createIntrosModule({ database });
    const createCaller = createCallerFactory(router({ intros: module.router }));
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
        return createCaller(contextFor(`Bearer ${token}`, dependencies, logger));
      },
    };
  }

  /** The refusal as a caller can actually observe it, flattened for set comparison. */
  interface ObservedRefusal {
    readonly code: string | undefined;
    readonly message: string | undefined;
    readonly applicationCode: string | undefined;
  }

  function observe(error: unknown): ObservedRefusal {
    const refusal = error as { code?: string; message?: string; cause?: { code?: string } };
    return {
      code: refusal.code,
      message: refusal.message,
      applicationCode: refusal.cause?.code,
    };
  }

  /**
   * Run something that must be refused, and hand back the refusal as a caller sees it.
   *
   * ⚠ The "expected to be refused" throw is **after** the `catch`, not inside the `try`.
   * Inside, this helper's own control-flow error would be caught and reported as if it
   * were the server's answer — and an operation that wrongly *succeeded* would then
   * produce matching objects and a green indistinguishability assertion.
   */
  async function refusalOf(
    operation: () => Promise<unknown>,
    description: string,
  ): Promise<ObservedRefusal> {
    try {
      await operation();
    } catch (error) {
      return observe(error);
    }
    throw new Error(`${description} was expected to be refused`);
  }

  /**
   * A five-person world in which three of them occupy an **identical** graph position.
   *
   * `alice — bruno`, and `bruno` is separately connected to `cleo`, `cass` and `dana`, so
   * all three sit at exactly degree 2 from alice through the same via, and each sees the
   * other two and alice at degree 2 through bruno.
   *
   * ⚠ That symmetry is what makes the privacy assertions mean something. A control user
   * who merely "had no request" but stood somewhere else in the graph would differ from
   * the target for reasons that have nothing to do with intros, and `toEqual` would then
   * be measuring the fixture rather than the rule.
   */
  async function seedSymmetricWorld() {
    const alice = await seedOnboardedUser(`dusty_intro_a_${randomUUID().slice(0, 8)}`);
    const bruno = await seedOnboardedUser(`dusty_intro_b_${randomUUID().slice(0, 8)}`);
    const cleo = await seedOnboardedUser(`dusty_intro_c_${randomUUID().slice(0, 8)}`);
    const cass = await seedOnboardedUser(`dusty_intro_x_${randomUUID().slice(0, 8)}`);
    const dana = await seedOnboardedUser(`dusty_intro_d_${randomUUID().slice(0, 8)}`);
    await connect(alice.userId, bruno.userId);
    await connect(bruno.userId, cleo.userId);
    await connect(bruno.userId, cass.userId);
    await connect(bruno.userId, dana.userId);
    return { alice, bruno, cleo, cass, dana };
  }

  describe('Scenario: An intro request reaches its via and nobody else (@integration, #89, AC1/AC9)', () => {
    it('writes one row, answers naming the via, and shows up only on the via inbox', async () => {
      const { alice, bruno, cleo, cass } = await seedSymmetricWorld();
      const { callerFor } = makeCallers();
      const callerAlice = await callerFor(alice.authUserId);
      const callerBruno = await callerFor(bruno.authUserId);
      const callerCleo = await callerFor(cleo.authUserId);
      const callerCass = await callerFor(cass.authUserId);

      const created = await callerAlice.intros.request({
        targetUserId: cleo.userId,
        viaUserId: bruno.userId,
        note: `   ${NOTE}   `,
      });

      expect(created.viaUserId).toBe(bruno.userId);
      expect(created.targetUserId).toBe(cleo.userId);
      expect(created.status).toBe('requested');
      expect(created.decidedAt).toBeUndefined();

      const stored = await introRequestRows();
      expect(stored).toHaveLength(1);
      expect(stored[0]?.requester_id).toBe(alice.userId);
      expect(stored[0]?.via_id).toBe(bruno.userId);
      expect(stored[0]?.target_id).toBe(cleo.userId);
      // Trimmed, because the policy's return value is what gets stored — a caller that
      // used its own input instead would leave the trim as advice.
      expect(stored[0]?.note).toBe(NOTE);
      // Nobody has passed anything on, so there is no via note — and the table's
      // `via_note is null or status = 'passed_on'` CHECK says there cannot be one.
      expect(stored[0]?.via_note).toBeNull();
      expect(stored[0]?.status).toBe('requested');
      expect(stored[0]?.decided_at).toBeNull();

      const forBruno = await callerBruno.intros.listInbox();
      expect(forBruno).toHaveLength(1);
      expect(forBruno[0]?.role).toBe('via');
      expect(forBruno[0]?.note).toBe(NOTE);
      expect(forBruno[0]?.requester?.userId).toBe(alice.userId);
      expect(forBruno[0]?.requester?.displayName).toBe(alice.handle);
      // A `via` row names both other parties — the via is judging a pairing, not a person.
      expect(forBruno[0]?.target?.userId).toBe(cleo.userId);
      // ⚠ And it names neither the via nor a via note: this row is an ask still waiting
      // on them, so a card here could only say "you" and there is no vouch to carry yet.
      expect(Object.keys(forBruno[0] ?? {})).not.toContain('via');
      expect(Object.keys(forBruno[0] ?? {})).not.toContain('viaNote');

      // ⚠ The target sees nothing at all before the via acts, and their answer is
      // byte-for-byte the answer of somebody in the same position nobody asked about.
      const forCleo = await callerCleo.intros.listInbox();
      const forCass = await callerCass.intros.listInbox();
      expect(forCass).toEqual([]);
      expect(forCleo).toEqual(forCass);
    });
  });

  describe('Scenario: Every ineligible target is refused identically (@integration, #89, AC2)', () => {
    it('serializes seven refusals into a one-element Set and writes nothing', async () => {
      // A—B—C—D—E—F—G, so B is degree 1, C degree 2, D degree 3 … G degree 6.
      const alice = await seedOnboardedUser('dusty_intro_matrix_a');
      const bruno = await seedOnboardedUser('dusty_intro_matrix_b');
      const chain = [bruno];
      for (const handle of ['c', 'd', 'e', 'f', 'g']) {
        chain.push(await seedOnboardedUser(`dusty_intro_matrix_${handle}`));
      }
      await connect(alice.userId, bruno.userId);
      for (let index = 0; index + 1 < chain.length; index += 1) {
        const near = chain[index];
        const far = chain[index + 1];
        if (near === undefined || far === undefined) {
          throw new Error('chain seeding produced a hole');
        }
        await connect(near.userId, far.userId);
      }
      const atThirdDegree = chain[2];
      const atSixthDegree = chain[5];

      // Two more second-degree people, each refused for a reason of their own.
      const gone = await seedOnboardedUser('dusty_intro_matrix_gone');
      const hidden = await seedOnboardedUser('dusty_intro_matrix_hidden');
      await connect(bruno.userId, gone.userId);
      await connect(bruno.userId, hidden.userId);
      await deactivate(gone.userId);
      await setReach(hidden.userId, 'first');

      if (atThirdDegree === undefined || atSixthDegree === undefined) {
        throw new Error('chain seeding produced too few people');
      }

      const { callerFor } = makeCallers();
      const callerAlice = await callerFor(alice.authUserId);

      const refusalFor = async (targetUserId: string): Promise<ObservedRefusal> =>
        refusalOf(
          async () =>
            callerAlice.intros.request({
              targetUserId,
              viaUserId: bruno.userId,
              note: NOTE,
            }),
          `requesting an intro to ${targetUserId}`,
        );

      const refusals = [
        // already a direct connection
        await refusalFor(bruno.userId),
        await refusalFor(atThirdDegree.userId),
        await refusalFor(atSixthDegree.userId),
        // absent from the graph entirely — a UUID naming nobody
        await refusalFor(randomUUID()),
        await refusalFor(gone.userId),
        // the requester themselves; nobody is at degree 2 of themselves
        await refusalFor(alice.userId),
        await refusalFor(hidden.userId),
      ];

      // ⚠ **One element.** Any difference at all between these seven turns the endpoint
      // into a user-existence and a graph-shape oracle in a product that has no people
      // search (ADR-0002 §10, B17).
      const distinct = new Set(refusals.map((refusal) => JSON.stringify(refusal)));
      expect([...distinct]).toHaveLength(1);
      expect(refusals[0]?.code).toBe('NOT_FOUND');
      expect(refusals[0]?.applicationCode).toBe('INTRO_UNAVAILABLE');

      expect(await introRequestRows()).toEqual([]);
      expect(await outboxRows()).toEqual([]);
    });
  });

  describe('Scenario: A via who does not know the target is refused the same way (@integration, #89, AC3)', () => {
    it('refuses a genuine first-degree connection who is not a shared one', async () => {
      const { alice, bruno, cleo } = await seedSymmetricWorld();
      // A real first-degree connection of alice's who knows nobody else.
      const felix = await seedOnboardedUser('dusty_intro_unshared_f');
      await connect(alice.userId, felix.userId);

      const { callerFor } = makeCallers();
      const callerAlice = await callerFor(alice.authUserId);

      const refusals: ObservedRefusal[] = [];
      for (const viaUserId of [felix.userId, randomUUID()]) {
        refusals.push(
          await refusalOf(
            async () =>
              callerAlice.intros.request({
                targetUserId: cleo.userId,
                viaUserId,
                note: NOTE,
              }),
            `naming ${viaUserId} as via`,
          ),
        );
      }

      // "That person exists and is your friend but does not know them" and "that UUID
      // names nobody" are the same answer — otherwise the endpoint reports on the
      // *target's* connections, which is the whole thing the graph withholds.
      expect(new Set(refusals.map((refusal) => JSON.stringify(refusal))).size).toBe(1);
      expect(refusals[0]?.applicationCode).toBe('INTRO_UNAVAILABLE');
      expect(await introRequestRows()).toEqual([]);
      expect(await outboxRows()).toEqual([]);

      // The control that keeps the assertion honest: the *right* via is accepted, so the
      // refusals above are about the via and not about a broken fixture.
      await expect(
        callerAlice.intros.request({
          targetUserId: cleo.userId,
          viaUserId: bruno.userId,
          note: NOTE,
        }),
      ).resolves.toMatchObject({ viaUserId: bruno.userId });
    });
  });

  describe('Scenario: One open request per pair, whatever the via (@integration, #89, AC4)', () => {
    it('refuses a second ask with INTRO_UNAVAILABLE rather than a unique violation', async () => {
      const { alice, bruno, cleo } = await seedSymmetricWorld();
      // A second shared connection, so the second ask differs only in its via.
      const bex = await seedOnboardedUser('dusty_intro_pair_b2');
      await connect(alice.userId, bex.userId);
      await connect(bex.userId, cleo.userId);

      const { callerFor } = makeCallers();
      const callerAlice = await callerFor(alice.authUserId);

      await callerAlice.intros.request({
        targetUserId: cleo.userId,
        viaUserId: bruno.userId,
        note: NOTE,
      });

      // ⚠ `NOT_FOUND` / `INTRO_UNAVAILABLE`, never a 500 carrying a constraint name. The
      // `on conflict do nothing` inside the insert is what turns the index into the
      // ordinary refusal.
      await expect(
        callerAlice.intros.request({
          targetUserId: cleo.userId,
          viaUserId: bex.userId,
          note: NOTE,
        }),
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
        cause: expect.objectContaining({ code: 'INTRO_UNAVAILABLE' }),
      });

      expect(await introRequestRows()).toHaveLength(1);
      expect(await outboxRows()).toHaveLength(1);
    });

    it('leaves exactly one row when two requests for the pair race', async () => {
      const { alice, bruno, cleo } = await seedSymmetricWorld();
      const bex = await seedOnboardedUser('dusty_intro_race_b2');
      await connect(alice.userId, bex.userId);
      await connect(bex.userId, cleo.userId);

      const { callerFor } = makeCallers();
      const callerAlice = await callerFor(alice.authUserId);

      // Both in flight before either resolves. The loser blocks on the partial unique
      // index and then inserts nothing — there is no read-then-write window for it to
      // win, which is why this is a statement-level rule rather than a service-level one.
      const outcomes = await Promise.allSettled([
        callerAlice.intros.request({
          targetUserId: cleo.userId,
          viaUserId: bruno.userId,
          note: NOTE,
        }),
        callerAlice.intros.request({
          targetUserId: cleo.userId,
          viaUserId: bex.userId,
          note: NOTE,
        }),
      ]);

      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
      const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
      expect(rejected?.status === 'rejected' ? observe(rejected.reason).applicationCode : null).toBe(
        'INTRO_UNAVAILABLE',
      );
      expect(await introRequestRows()).toHaveLength(1);
      expect(await outboxRows()).toHaveLength(1);
    });
  });

  describe('Scenario: Only the named via may decide (@integration, #89, AC5)', () => {
    it('refuses the requester, the target and a fourth party, changing nothing', async () => {
      const { alice, bruno, cleo, dana } = await seedSymmetricWorld();
      const { callerFor } = makeCallers();
      const callerAlice = await callerFor(alice.authUserId);

      const created = await callerAlice.intros.request({
        targetUserId: cleo.userId,
        viaUserId: bruno.userId,
        note: NOTE,
      });

      const refusals: ObservedRefusal[] = [];
      for (const impostor of [alice, cleo, dana]) {
        const caller = await callerFor(impostor.authUserId);
        refusals.push(
          await refusalOf(
            async () => caller.intros.decide(passOn(created.id)),
            `${impostor.handle} deciding somebody else's request`,
          ),
        );
      }
      // A request that never existed answers the same way, which is what stops `decide`
      // being a probe for "is there an intro request with this id".
      const callerBruno = await callerFor(bruno.authUserId);
      refusals.push(
        await refusalOf(
          async () =>
            callerBruno.intros.decide(passOn(randomUUID())),
          'deciding a request that does not exist',
        ),
      );

      expect(new Set(refusals.map((refusal) => JSON.stringify(refusal))).size).toBe(1);
      expect(refusals[0]?.applicationCode).toBe('INTRO_UNAVAILABLE');

      const stored = await introRequestRows();
      expect(stored).toHaveLength(1);
      expect(stored[0]?.status).toBe('requested');
      expect(stored[0]?.decided_at).toBeNull();
      // Only the `IntroRequested` row from the ask itself.
      expect(await outboxRows()).toHaveLength(1);
    });
  });

  describe('Scenario: A decision is made once (@integration, #89, AC6)', () => {
    it('refuses a second decision without overwriting decided_at', async () => {
      const { alice, bruno, cleo } = await seedSymmetricWorld();
      const { callerFor } = makeCallers();
      const callerAlice = await callerFor(alice.authUserId);
      const callerBruno = await callerFor(bruno.authUserId);

      const created = await callerAlice.intros.request({
        targetUserId: cleo.userId,
        viaUserId: bruno.userId,
        note: NOTE,
      });
      const decided = await callerBruno.intros.decide(passOn(created.id));
      expect(decided.status).toBe('passed_on');
      expect(decided.decidedAt).toBeDefined();
      // ⚠ The receipt is the acting via's own view of the row and carries **neither**
      // note: they wrote one of them a second ago, and the other is the requester's.
      expect(JSON.stringify(decided)).not.toContain(DISTINCTIVE_VIA_PHRASE);
      expect(JSON.stringify(decided)).not.toContain(DISTINCTIVE_PHRASE);

      // Both directions, spelled as two whole commands rather than one loop over a
      // `decision` variable: `intros.decide` takes a discriminated union now, so the two
      // decisions genuinely do not have one shape to iterate over.
      const secondAttempts = [
        passOn(created.id),
        { introRequestId: created.id, decision: 'decline' },
      ] as const;

      for (const second of secondAttempts) {
        await expect(callerBruno.intros.decide(second)).rejects.toMatchObject({
          code: 'NOT_FOUND',
          cause: expect.objectContaining({ code: 'INTRO_UNAVAILABLE' }),
        });
      }

      const stored = await introRequestRows();
      expect(stored[0]?.status).toBe('passed_on');
      expect(stored[0]?.decided_at?.toISOString()).toBe(decided.decidedAt);
      // One request event and one decision event: the two refused attempts wrote nothing.
      expect(await outboxRows()).toHaveLength(2);
    });

    it('leaves exactly one winner when two decisions race', async () => {
      const { alice, bruno, cleo } = await seedSymmetricWorld();
      const { callerFor } = makeCallers();
      const callerAlice = await callerFor(alice.authUserId);
      const callerBruno = await callerFor(bruno.authUserId);

      const created = await callerAlice.intros.request({
        targetUserId: cleo.userId,
        viaUserId: bruno.userId,
        note: NOTE,
      });

      // Opposite decisions, in flight together. `where status = 'requested'` is the
      // concurrency control: the loser blocks on the row, re-evaluates against the
      // committed status, matches nothing, and is refused.
      const outcomes = await Promise.allSettled([
        callerBruno.intros.decide(passOn(created.id)),
        callerBruno.intros.decide({ introRequestId: created.id, decision: 'decline' }),
      ]);

      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
      const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
      expect(rejected?.status === 'rejected' ? observe(rejected.reason).applicationCode : null).toBe(
        'INTRO_UNAVAILABLE',
      );
      expect(await outboxRows()).toHaveLength(2);
    });
  });

  describe('Scenario: A pass-on whose eligibility has lapsed is refused; a decline is not (@integration, #89, AC7)', () => {
    it('refuses the pass-on, discloses nothing to the target, and still lets the via decline', async () => {
      const { alice, bruno, cleo, cass } = await seedSymmetricWorld();
      const { callerFor } = makeCallers();
      const callerAlice = await callerFor(alice.authUserId);
      const callerBruno = await callerFor(bruno.authUserId);
      const callerCleo = await callerFor(cleo.authUserId);
      const callerCass = await callerFor(cass.authUserId);

      const created = await callerAlice.intros.request({
        targetUserId: cleo.userId,
        viaUserId: bruno.userId,
        note: NOTE,
      });

      // The via and the target part company after the ask. A request is not a snapshot:
      // passing it on now would introduce alice to somebody bruno no longer knows.
      await sever(bruno.userId, cleo.userId);

      await expect(
        callerBruno.intros.decide(passOn(created.id)),
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
        cause: expect.objectContaining({ code: 'INTRO_UNAVAILABLE' }),
      });

      // Nothing changed, and the target still knows nothing.
      expect((await introRequestRows())[0]?.status).toBe('requested');
      expect(await callerCleo.intros.listInbox()).toEqual(await callerCass.intros.listInbox());

      // ⚠ And the via is not stuck holding it. Declining discloses nothing to anybody, so
      // it stays available for as long as the request is open — a via who could neither
      // pass on nor decline would be left carrying somebody else's ask forever.
      const declined = await callerBruno.intros.decide({
        introRequestId: created.id,
        decision: 'decline',
      });
      expect(declined.status).toBe('declined');
    });

    it("refuses the pass-on when the target's own reach setting has dropped below the requester", async () => {
      const { alice, bruno, cleo } = await seedSymmetricWorld();
      const { callerFor } = makeCallers();
      const callerAlice = await callerFor(alice.authUserId);
      const callerBruno = await callerFor(bruno.authUserId);

      const created = await callerAlice.intros.request({
        targetUserId: cleo.userId,
        viaUserId: bruno.userId,
        note: NOTE,
      });

      // The target decides only direct connections may see they exist. That is a
      // withdrawal of reachability, and the pass-on has to honour the setting as it is
      // now rather than as it was when the ask was written.
      await setReach(cleo.userId, 'first');

      await expect(
        callerBruno.intros.decide(passOn(created.id)),
      ).rejects.toMatchObject({
        cause: expect.objectContaining({ code: 'INTRO_UNAVAILABLE' }),
      });
      expect((await introRequestRows())[0]?.status).toBe('requested');
    });
  });

  describe('Scenario: A declined request is invisible to its target forever (@integration, #89, AC8)', () => {
    it('answers the target exactly as it answers somebody nobody ever asked about', async () => {
      const { alice, bruno, cleo, cass } = await seedSymmetricWorld();
      const { callerFor } = makeCallers();
      const callerAlice = await callerFor(alice.authUserId);
      const callerBruno = await callerFor(bruno.authUserId);
      const callerCleo = await callerFor(cleo.authUserId);
      const callerCass = await callerFor(cass.authUserId);

      const created = await callerAlice.intros.request({
        targetUserId: cleo.userId,
        viaUserId: bruno.userId,
        note: NOTE,
      });
      await callerBruno.intros.decide({ introRequestId: created.id, decision: 'decline' });

      // ⚠ Deep equality across **every** intros read, against a control standing in the
      // same graph position. cass was never asked about; cleo was asked about and
      // declined. If those two answers differ anywhere, the target can tell — and a via
      // who knows the target can tell is a via who cannot safely decline.
      expect(await callerCleo.intros.listInbox()).toEqual(await callerCass.intros.listInbox());
      expect(await callerCleo.intros.listOutbox()).toEqual(await callerCass.intros.listOutbox());
      expect(
        await callerCleo.intros.viaCandidates({ targetUserId: alice.userId }),
      ).toEqual(await callerCass.intros.viaCandidates({ targetUserId: alice.userId }));

      // The control of the control: the two reads that should be empty are, and the one
      // that should not be is not — so the equalities above are not three ways of saying
      // `[] === []`.
      expect(await callerCass.intros.listInbox()).toEqual([]);
      expect(await callerCass.intros.listOutbox()).toEqual([]);
      expect(await callerCass.intros.viaCandidates({ targetUserId: alice.userId })).toHaveLength(1);

      // And the requester does learn, without learning why.
      const forAlice = await callerAlice.intros.listOutbox();
      expect(forAlice).toHaveLength(1);
      expect(forAlice[0]?.status).toBe('declined');
      expect(JSON.stringify(forAlice[0])).not.toContain(DISTINCTIVE_PHRASE);
    });
  });

  describe('Scenario: The inbox is dual-role and never any other combination (@integration, #89, AC9)', () => {
    it('gives the via the open ask and the target the passed-on introduction, and nothing crosses', async () => {
      const { alice, bruno, cleo, cass } = await seedSymmetricWorld();
      const { callerFor } = makeCallers();
      const callerAlice = await callerFor(alice.authUserId);
      const callerBruno = await callerFor(bruno.authUserId);
      const callerCleo = await callerFor(cleo.authUserId);
      const callerCass = await callerFor(cass.authUserId);

      const created = await callerAlice.intros.request({
        targetUserId: cleo.userId,
        viaUserId: bruno.userId,
        note: NOTE,
      });

      // Before the decision: the via holds it, the target is indistinguishable from
      // somebody nobody asked about.
      expect(await callerBruno.intros.listInbox()).toHaveLength(1);
      expect(await callerCleo.intros.listInbox()).toEqual(await callerCass.intros.listInbox());

      await callerBruno.intros.decide(passOn(created.id));

      const forCleo = await callerCleo.intros.listInbox();
      expect(forCleo).toHaveLength(1);
      expect(forCleo[0]?.role).toBe('target');
      expect(forCleo[0]?.note).toBe(NOTE);
      expect(forCleo[0]?.requester?.userId).toBe(alice.userId);
      expect(forCleo[0]?.requester?.displayName).toBe(alice.handle);
      // ⚠ **Two notes, two authors, both attributed** (#175). The vouch arrives with the
      // via's own card beside it, because a note the target cannot attribute is worse
      // than no note — and because the whole point of the requirement is that somebody
      // they know put their name to it.
      expect(forCleo[0]?.viaNote).toBe(VIA_NOTE);
      expect(forCleo[0]?.via?.userId).toBe(bruno.userId);
      expect(forCleo[0]?.via?.displayName).toBe(bruno.handle);
      // ⚠ No `target` key at all: the target is the reader, so the field could only ever
      // say "you". Absent rather than null, so a client has nothing to render into.
      expect(Object.keys(forCleo[0] ?? {})).not.toContain('target');

      // The via's row is gone the moment it stops being `requested` — an inbox is what is
      // waiting on you, and nothing is.
      expect(await callerBruno.intros.listInbox()).toEqual([]);
      // And the requester never has an inbox row for their own ask, in either state.
      expect(await callerAlice.intros.listInbox()).toEqual([]);
    });
  });

  describe('Scenario: A fourth party sees nothing (@integration, #89, AC10)', () => {
    it('answers an uninvolved neighbour exactly as it answers the never-asked control', async () => {
      const { alice, bruno, cleo, cass, dana } = await seedSymmetricWorld();
      const { callerFor } = makeCallers();
      const callerAlice = await callerFor(alice.authUserId);
      const callerBruno = await callerFor(bruno.authUserId);
      const callerCass = await callerFor(cass.authUserId);
      const callerDana = await callerFor(dana.authUserId);

      const created = await callerAlice.intros.request({
        targetUserId: cleo.userId,
        viaUserId: bruno.userId,
        note: NOTE,
      });
      await callerBruno.intros.decide(passOn(created.id));

      // dana stands beside cleo — same via, same degree, no involvement. A completed
      // introduction between three of their neighbours must be invisible to them.
      expect(await callerDana.intros.listInbox()).toEqual(await callerCass.intros.listInbox());
      expect(await callerDana.intros.listOutbox()).toEqual(await callerCass.intros.listOutbox());
      expect(
        await callerDana.intros.viaCandidates({ targetUserId: alice.userId }),
      ).toEqual(await callerCass.intros.viaCandidates({ targetUserId: alice.userId }));
      expect(await callerDana.intros.listInbox()).toEqual([]);
    });
  });

  describe('Scenario: Asking is consent to be seen (@integration, #89, AC11)', () => {
    it('discloses the requester to the target even when their own reach setting would hide them', async () => {
      const { alice, bruno, cleo } = await seedSymmetricWorld();
      const { callerFor } = makeCallers();
      const callerAlice = await callerFor(alice.authUserId);
      const callerBruno = await callerFor(bruno.authUserId);
      const callerCleo = await callerFor(cleo.authUserId);

      // alice says only direct connections may see she exists. cleo is two hops away.
      await setReach(alice.userId, 'first');

      const invisible = await testDatabase.client.query(
        `select 1 from app.visible_people($1) where user_id = $2`,
        [cleo.userId, alice.userId],
      );
      expect(
        invisible.rowCount,
        'the scenario is only meaningful while the target cannot otherwise see the requester',
      ).toBe(0);

      const created = await callerAlice.intros.request({
        targetUserId: cleo.userId,
        viaUserId: bruno.userId,
        note: NOTE,
      });
      await callerBruno.intros.decide(passOn(created.id));

      // ⚠ **The request is the consent.** alice chose to be introduced, so alice's own
      // card is what the target is shown — projected from `app.visible_people(alice,0,1)`,
      // her self-disclosure, never from a join to `app.users`.
      const forCleo = await callerCleo.intros.listInbox();
      expect(forCleo).toHaveLength(1);
      expect(forCleo[0]?.requester?.userId).toBe(alice.userId);
      expect(forCleo[0]?.requester?.disclosure).toBe('full');
      expect(forCleo[0]?.requester?.displayName).toBe(alice.handle);
      expect(forCleo[0]?.note).toBe(NOTE);
    });

    it('withdraws the card again if the requester deactivates', async () => {
      const { alice, bruno, cleo } = await seedSymmetricWorld();
      const { callerFor } = makeCallers();
      const callerAlice = await callerFor(alice.authUserId);
      const callerBruno = await callerFor(bruno.authUserId);
      const callerCleo = await callerFor(cleo.authUserId);

      const created = await callerAlice.intros.request({
        targetUserId: cleo.userId,
        viaUserId: bruno.userId,
        note: NOTE,
      });
      await callerBruno.intros.decide(passOn(created.id));
      await deactivate(alice.userId);

      // Consent is not a snapshot either. The introduction stays — it was made, and the
      // target was told — and the person goes, because the card is projected on every read
      // (ADR-0002 B11). The identifier goes with them: no shape of this row hands back the
      // `app.users.id` of somebody the projection has excluded.
      const forCleo = await callerCleo.intros.listInbox();
      expect(forCleo).toHaveLength(1);
      expect(forCleo[0]?.note).toBe(NOTE);
      expect(forCleo[0]?.requester).toBeUndefined();
      expect(JSON.stringify(forCleo[0])).not.toContain(alice.userId);
    });
  });

  describe('Scenario: Passing an intro on requires a note of the via’s own (@integration, #175)', () => {
    /*
     * ⚠ Two tests below hand `intros.decide` a shape the contract's union makes
     * unrepresentable, through an `as never` cast, and the cast is the point rather than
     * a workaround. A typed client cannot send a pass-on with no note or a decline
     * carrying one — that is exactly what the union buys — so handing the server what
     * TypeScript would have stopped is the only way to prove the *wire schema* refuses
     * them. Without it the schema could be deleted and every test here would stay green.
     */

    it('stores the via’s note on the row and hands it only to the target', async () => {
      const { alice, bruno, cleo } = await seedSymmetricWorld();
      const { callerFor } = makeCallers();
      const callerAlice = await callerFor(alice.authUserId);
      const callerBruno = await callerFor(bruno.authUserId);

      const created = await callerAlice.intros.request({
        targetUserId: cleo.userId,
        viaUserId: bruno.userId,
        note: NOTE,
      });
      await callerBruno.intros.decide({
        introRequestId: created.id,
        decision: 'pass_on',
        // Padded, because the trim is the policy's return value and the caller has to
        // store *that* — otherwise the trim is advice and the target reads the padding.
        note: `   ${VIA_NOTE}   `,
      });

      const stored = await introRequestRows();
      expect(stored).toHaveLength(1);
      expect(stored[0]?.status).toBe('passed_on');
      expect(stored[0]?.via_note).toBe(VIA_NOTE);
      // One row carries both notes and they stay distinguishable: a via note appended to
      // the requester's would be two people's words under one name.
      expect(stored[0]?.note).toBe(NOTE);

      // ⚠ The via cannot read their own vouch back on any intros read. It was written to
      // one person, and a second copy on a surface they can refresh is the copy this
      // module refuses everywhere else.
      const backToBruno = JSON.stringify([
        await callerBruno.intros.listInbox(),
        await callerBruno.intros.listOutbox(),
      ]);
      expect(backToBruno).not.toContain(DISTINCTIVE_VIA_PHRASE);
    });

    it('refuses a pass-on carrying no note at all, leaving the request open', async () => {
      const { alice, bruno, cleo } = await seedSymmetricWorld();
      const { callerFor } = makeCallers();
      const callerAlice = await callerFor(alice.authUserId);
      const callerBruno = await callerFor(bruno.authUserId);

      const created = await callerAlice.intros.request({
        targetUserId: cleo.userId,
        viaUserId: bruno.userId,
        note: NOTE,
      });

      const refusal = await refusalOf(
        async () =>
          callerBruno.intros.decide({ introRequestId: created.id, decision: 'pass_on' } as never),
        'passing an intro on with no note',
      );
      expect(refusal.code).toBe('BAD_REQUEST');

      // ⚠ Refused **and nothing written**: the request is still the via's to decide, and
      // a row that reached `passed_on` while the note write failed would be an
      // introduction the target reads unvouched.
      const stored = await introRequestRows();
      expect(stored[0]?.status).toBe('requested');
      expect(stored[0]?.decided_at).toBeNull();
      expect(stored[0]?.via_note).toBeNull();
      // Only the `IntroRequested` row from the ask itself.
      expect(await outboxRows()).toHaveLength(1);
    });

    it('refuses a whitespace-only and an over-long via note with the content code', async () => {
      const { alice, bruno, cleo } = await seedSymmetricWorld();
      const { callerFor } = makeCallers();
      const callerAlice = await callerFor(alice.authUserId);
      const callerBruno = await callerFor(bruno.authUserId);

      const created = await callerAlice.intros.request({
        targetUserId: cleo.userId,
        viaUserId: bruno.userId,
        note: NOTE,
      });

      // Both are well-formed strings on the wire and refused by the domain, which is why
      // they come back as the stable `INTRO_CONTENT_INVALID` rather than a generic
      // `BAD_REQUEST` — a client puts that message beside the textarea.
      for (const note of ['   ', 'x'.repeat(INTRO_NOTE_MAX_LENGTH + 1)]) {
        await expect(
          callerBruno.intros.decide({ introRequestId: created.id, decision: 'pass_on', note }),
        ).rejects.toMatchObject({
          code: 'BAD_REQUEST',
          cause: expect.objectContaining({ code: 'INTRO_CONTENT_INVALID' }),
        });
      }

      expect((await introRequestRows())[0]?.status).toBe('requested');
      expect(await outboxRows()).toHaveLength(1);

      // The control that keeps the two refusals honest: one character is enough, so the
      // rule under test is the bound rather than a decide path that refuses everything.
      await expect(
        callerBruno.intros.decide({ introRequestId: created.id, decision: 'pass_on', note: 'x' }),
      ).resolves.toMatchObject({ status: 'passed_on' });
    });

    it('refuses a decline that carries a note, and stores none on an ordinary one', async () => {
      const { alice, bruno, cleo } = await seedSymmetricWorld();
      const { callerFor } = makeCallers();
      const callerAlice = await callerFor(alice.authUserId);
      const callerBruno = await callerFor(bruno.authUserId);

      const created = await callerAlice.intros.request({
        targetUserId: cleo.userId,
        viaUserId: bruno.userId,
        note: NOTE,
      });

      // ⚠ **Refused, not silently dropped.** A decline's rationale has no reader — the
      // requester is told only that it was not passed on — so accepting the field and
      // discarding it would let its writer believe otherwise.
      const refusal = await refusalOf(
        async () =>
          callerBruno.intros.decide({
            introRequestId: created.id,
            decision: 'decline',
            note: VIA_NOTE,
          } as never),
        'declining with a note',
      );
      expect(refusal.code).toBe('BAD_REQUEST');
      expect((await introRequestRows())[0]?.status).toBe('requested');

      const declined = await callerBruno.intros.decide({
        introRequestId: created.id,
        decision: 'decline',
      });
      expect(declined.status).toBe('declined');

      const stored = await introRequestRows();
      expect(stored[0]?.via_note).toBeNull();
      // And the phrase reaches neither the stored row nor any event.
      expect(JSON.stringify(await outboxRows())).not.toContain(DISTINCTIVE_VIA_PHRASE);
    });

    it('leaves the vouch standing, unattributed, when the via deactivates afterwards', async () => {
      const { alice, bruno, cleo } = await seedSymmetricWorld();
      const { callerFor } = makeCallers();
      const callerAlice = await callerFor(alice.authUserId);
      const callerBruno = await callerFor(bruno.authUserId);
      const callerCleo = await callerFor(cleo.authUserId);

      const created = await callerAlice.intros.request({
        targetUserId: cleo.userId,
        viaUserId: bruno.userId,
        note: NOTE,
      });
      await callerBruno.intros.decide(passOn(created.id));
      await deactivate(bruno.userId);

      // The card is projected on every read (ADR-0002 B11), so it goes when the person
      // does — and the words stay, because they were written and delivered. The client
      // renders them under the withheld treatment; what must never happen is a name
      // reconstructed from the identifier, so the identifier is not there either.
      const forCleo = await callerCleo.intros.listInbox();
      expect(forCleo).toHaveLength(1);
      expect(forCleo[0]?.viaNote).toBe(VIA_NOTE);
      expect(forCleo[0]?.via).toBeUndefined();
      expect(JSON.stringify(forCleo[0])).not.toContain(bruno.userId);
    });

    it('names the via from their own self-projection, not from the target’s world', async () => {
      const { alice, bruno, cleo } = await seedSymmetricWorld();
      const { callerFor } = makeCallers();
      const callerAlice = await callerFor(alice.authUserId);
      const callerBruno = await callerFor(bruno.authUserId);
      const callerCleo = await callerFor(cleo.authUserId);

      const created = await callerAlice.intros.request({
        targetUserId: cleo.userId,
        viaUserId: bruno.userId,
        note: NOTE,
      });
      await callerBruno.intros.decide(passOn(created.id));

      // The via and the target part company after the introduction is made. `app.
      // visible_people(target)` no longer contains the via at all — and the vouch is
      // still signed, because choosing to pass an intro on is choosing to be seen by the
      // target as its via. The same consent inversion the requester's card rests on.
      await sever(bruno.userId, cleo.userId);
      const gone = await testDatabase.client.query(
        `select 1 from app.visible_people($1) where user_id = $2`,
        [cleo.userId, bruno.userId],
      );
      expect(
        gone.rowCount,
        'the scenario is only meaningful once the target cannot otherwise see the via',
      ).toBe(0);

      const forCleo = await callerCleo.intros.listInbox();
      expect(forCleo[0]?.viaNote).toBe(VIA_NOTE);
      expect(forCleo[0]?.via?.userId).toBe(bruno.userId);
      // Their own `full` self-disclosure, projected through `app.visible_people` — never
      // a join to `app.users` (ADR-0002 §6a).
      expect(forCleo[0]?.via?.disclosure).toBe('full');
      expect(forCleo[0]?.via?.displayName).toBe(bruno.handle);
    });
  });

  describe('Scenario: Accepting a passed-on introduction connects the target to the requester (@integration, #166, AC1/AC2)', () => {
    it('records the answer, emits IntroAccepted, and the event is what makes the connection', async () => {
      const { alice, bruno, cleo, cass } = await seedSymmetricWorld();
      const { callerFor } = makeCallers();
      const callerAlice = await callerFor(alice.authUserId);
      const callerBruno = await callerFor(bruno.authUserId);
      const callerCleo = await callerFor(cleo.authUserId);
      const callerCass = await callerFor(cass.authUserId);

      const created = await callerAlice.intros.request({
        targetUserId: cleo.userId,
        viaUserId: bruno.userId,
        note: NOTE,
      });
      const decided = await callerBruno.intros.decide(passOn(created.id));

      const answered = await callerCleo.intros.respond({
        introRequestId: created.id,
        response: 'accept',
      });

      expect(answered.status).toBe('accepted');
      expect(answered.respondedAt).toBeDefined();
      // ⚠ The via's timestamp is untouched. It says when the introduction was *made*, and
      // an acceptance that overwrote it would erase the only record of that.
      expect(answered.decidedAt).toBe(decided.decidedAt);

      const stored = await introRequestRows();
      expect(stored).toHaveLength(1);
      expect(stored[0]?.status).toBe('accepted');
      expect(stored[0]?.responded_at?.toISOString()).toBe(answered.respondedAt);
      expect(stored[0]?.decided_at?.toISOString()).toBe(decided.decidedAt);
      // ⚠ The vouch survives the status change, which is the half of the migration that
      // would otherwise fail silently: `intro_requests_via_note` was written when
      // `passed_on` was terminal, and the un-widened form refuses this very UPDATE.
      expect(stored[0]?.via_note).toBe(VIA_NOTE);

      const events = await outboxRows();
      const accepted = events.find((event) => event.event_type === 'IntroAccepted');
      // The target acted, so the target is the actor — not the via, whose name is on the
      // row and travels only for routing.
      expect(accepted?.actor_id).toBe(cleo.userId);
      expect(accepted?.aggregate_id).toBe(created.id);
      expect(accepted?.payload).toEqual({
        introRequestId: created.id,
        requesterId: alice.userId,
        viaId: bruno.userId,
        targetId: cleo.userId,
      });
      // Neither note, on the event that a consumer would most like to quote.
      expect(JSON.stringify(events)).not.toContain(DISTINCTIVE_PHRASE);
      expect(JSON.stringify(events)).not.toContain(DISTINCTIVE_VIA_PHRASE);

      // ⚠ **Nothing is connected yet, and that is decision D12 rather than a bug.** The
      // acceptance and its event are one transaction; the edge is written by
      // `modules/connections` from that event. Asserting the gap makes the next assertion
      // evidence that the seam works rather than evidence that something, somewhere, wrote
      // a row.
      const seededConnections = await connectionCount();
      expect(await connectionsBetween(alice.userId, cleo.userId)).toEqual([]);

      await deliverEveryEventTo(introducedPairConsumer());

      const connections = await connectionsBetween(alice.userId, cleo.userId);
      expect(connections).toHaveLength(1);
      // Exactly one row appeared, and it is that one: a consumer that also connected the
      // via to somebody would satisfy the pair assertion above on its own.
      expect(await connectionCount()).toBe(seededConnections + 1);
      const [userAId, userBId] =
        alice.userId < cleo.userId ? [alice.userId, cleo.userId] : [cleo.userId, alice.userId];
      expect(connections[0]?.user_a_id).toBe(userAId);
      expect(connections[0]?.user_b_id).toBe(userBId);
      // ⚠ **An accepted invite's own semantics, taken from the columns' defaults rather
      // than restated here** — `full` both ways, `accepted`. An intro-formed connection
      // that disclosed less than an invite-formed one would be a second connection model
      // nobody chose.
      expect(connections[0]?.status).toBe('accepted');
      expect(connections[0]?.a_discloses_to_b_level).toBe('full');
      expect(connections[0]?.b_discloses_to_a_level).toBe('full');
      // Dated by when the target accepted, never by when the event was delivered.
      expect(connections[0]?.created_at.toISOString()).toBe(answered.respondedAt);

      const connectionEvent = (await outboxRows()).find(
        (event) => event.event_type === 'ConnectionAccepted',
      );
      // Correlated to the introduction rather than to an invite, because there was none.
      expect(connectionEvent?.actor_id).toBe(cleo.userId);
      expect(connectionEvent?.payload).toMatchObject({ introRequestId: created.id });
      expect(Object.keys(connectionEvent?.payload ?? {})).not.toContain('invitationId');

      // ⚠ The connection is real, not merely a row: the one authorized-people definition
      // now answers with each of them on the other's graph at degree 1 (ADR-0002 §6).
      const { rowCount } = await testDatabase.client.query(
        `select 1 from app.visible_people($1) where user_id = $2 and degree = 1`,
        [alice.userId, cleo.userId],
      );
      expect(rowCount).toBe(1);

      // And the introduction leaves the inbox — an inbox is what is waiting on you, and
      // nothing is. Answered looks exactly like never-asked here, as it does for a via.
      expect(await callerCleo.intros.listInbox()).toEqual(await callerCass.intros.listInbox());
      expect(await callerCass.intros.listInbox()).toEqual([]);
    });
  });

  describe('Scenario: Declining a passed-on introduction connects nobody (@integration, #166, AC3)', () => {
    it('records the decline distinguishably, and delivering every event connects nobody', async () => {
      const { alice, bruno, cleo, dana } = await seedSymmetricWorld();
      const { callerFor } = makeCallers();
      const callerAlice = await callerFor(alice.authUserId);
      const callerBruno = await callerFor(bruno.authUserId);
      const callerCleo = await callerFor(cleo.authUserId);

      const toCleo = await callerAlice.intros.request({
        targetUserId: cleo.userId,
        viaUserId: bruno.userId,
        note: NOTE,
      });
      await callerBruno.intros.decide(passOn(toCleo.id));

      // A second introduction nobody answers, so "declined" is measured against "left
      // alone" rather than only against "accepted".
      const toDana = await callerAlice.intros.request({
        targetUserId: dana.userId,
        viaUserId: bruno.userId,
        note: NOTE,
      });
      await callerBruno.intros.decide(passOn(toDana.id));

      const answered = await callerCleo.intros.respond({
        introRequestId: toCleo.id,
        response: 'decline',
      });

      // ⚠ `target_declined`, and not the via's `declined`. The two are different facts by
      // different people, and the stored history has to be able to tell them apart — AC3.
      expect(answered.status).toBe('target_declined');
      expect(answered.respondedAt).toBeDefined();

      const stored = await introRequestRows();
      const declinedRow = stored.find((row) => row.id === toCleo.id);
      const untouchedRow = stored.find((row) => row.id === toDana.id);
      expect(declinedRow?.status).toBe('target_declined');
      expect(untouchedRow?.status).toBe('passed_on');
      expect(untouchedRow?.responded_at).toBeNull();

      // The fact happened and the audit trail is entitled to it.
      const events = await outboxRows();
      expect(events.filter((event) => event.event_type === 'IntroTargetDeclined')).toHaveLength(1);
      expect(events.filter((event) => event.event_type === 'IntroAccepted')).toHaveLength(0);

      // ⚠ Every event is offered, including the decline and the two pass-ons. A consumer
      // that had started acting on anything but `IntroAccepted` would connect people here.
      const seededConnections = await connectionCount();
      await deliverEveryEventTo(introducedPairConsumer());

      expect(await connectionsBetween(alice.userId, cleo.userId)).toEqual([]);
      // And the unanswered one connects nobody either — "declined" is measured against
      // "left alone", so neither may be the thing that wrote a row.
      expect(await connectionsBetween(alice.userId, dana.userId)).toEqual([]);
      expect(await connectionCount()).toBe(seededConnections);
      expect(
        (await outboxRows()).filter((event) => event.event_type === 'ConnectionAccepted'),
      ).toEqual([]);
    });
  });

  describe('Scenario: Only the target may answer a passed-on introduction (@integration, #166, AC4)', () => {
    it('refuses the requester, the via and a fourth party identically, changing nothing', async () => {
      const { alice, bruno, cleo, dana } = await seedSymmetricWorld();
      const { callerFor } = makeCallers();
      const callerAlice = await callerFor(alice.authUserId);
      const callerBruno = await callerFor(bruno.authUserId);

      const created = await callerAlice.intros.request({
        targetUserId: cleo.userId,
        viaUserId: bruno.userId,
        note: NOTE,
      });
      await callerBruno.intros.decide(passOn(created.id));

      const refusals: ObservedRefusal[] = [];
      for (const impostor of [alice, bruno, dana]) {
        const caller = await callerFor(impostor.authUserId);
        refusals.push(
          await refusalOf(
            async () =>
              caller.intros.respond({ introRequestId: created.id, response: 'accept' }),
            `${impostor.handle} answering somebody else's introduction`,
          ),
        );
      }
      // An introduction that never existed answers the same way, which is what stops
      // `respond` being a probe for "is there an introduction with this id".
      const callerCleo = await callerFor(cleo.authUserId);
      refusals.push(
        await refusalOf(
          async () => callerCleo.intros.respond({ introRequestId: randomUUID(), response: 'accept' }),
          'answering an introduction that does not exist',
        ),
      );

      expect(new Set(refusals.map((refusal) => JSON.stringify(refusal))).size).toBe(1);
      expect(refusals[0]?.code).toBe('NOT_FOUND');
      expect(refusals[0]?.applicationCode).toBe('INTRO_UNAVAILABLE');

      const stored = await introRequestRows();
      expect(stored).toHaveLength(1);
      expect(stored[0]?.status).toBe('passed_on');
      expect(stored[0]?.responded_at).toBeNull();

      // Refused **and nothing written**: no answer event, and therefore no connection even
      // once every event is delivered.
      const seededConnections = await connectionCount();
      await deliverEveryEventTo(introducedPairConsumer());
      expect(await connectionsBetween(alice.userId, cleo.userId)).toEqual([]);
      expect(await connectionCount()).toBe(seededConnections);
    });
  });

  describe('Scenario: An introduction is answered once, and only after it has been passed on (@integration, #166, AC5)', () => {
    it('refuses a second answer in either direction without moving responded_at', async () => {
      const { alice, bruno, cleo } = await seedSymmetricWorld();
      const { callerFor } = makeCallers();
      const callerAlice = await callerFor(alice.authUserId);
      const callerBruno = await callerFor(bruno.authUserId);
      const callerCleo = await callerFor(cleo.authUserId);

      const created = await callerAlice.intros.request({
        targetUserId: cleo.userId,
        viaUserId: bruno.userId,
        note: NOTE,
      });
      await callerBruno.intros.decide(passOn(created.id));
      const answered = await callerCleo.intros.respond({
        introRequestId: created.id,
        response: 'accept',
      });

      for (const response of ['accept', 'decline'] as const) {
        await expect(
          callerCleo.intros.respond({ introRequestId: created.id, response }),
        ).rejects.toMatchObject({
          code: 'NOT_FOUND',
          cause: expect.objectContaining({ code: 'INTRO_UNAVAILABLE' }),
        });
      }

      const stored = await introRequestRows();
      expect(stored[0]?.status).toBe('accepted');
      expect(stored[0]?.responded_at?.toISOString()).toBe(answered.respondedAt);
      // One request, one decision, one answer: the two refused attempts wrote nothing.
      expect(await outboxRows()).toHaveLength(3);
    });

    it('leaves exactly one winner when two answers race', async () => {
      const { alice, bruno, cleo } = await seedSymmetricWorld();
      const { callerFor } = makeCallers();
      const callerAlice = await callerFor(alice.authUserId);
      const callerBruno = await callerFor(bruno.authUserId);
      const callerCleo = await callerFor(cleo.authUserId);

      const created = await callerAlice.intros.request({
        targetUserId: cleo.userId,
        viaUserId: bruno.userId,
        note: NOTE,
      });
      await callerBruno.intros.decide(passOn(created.id));

      // Opposite answers, in flight together. `where status = 'passed_on'` is the
      // concurrency control: the loser blocks on the row, re-evaluates against the
      // committed status, matches nothing, and is refused — so the two can never both
      // write, and a connection can never be formed by a race the target did not win.
      const outcomes = await Promise.allSettled([
        callerCleo.intros.respond({ introRequestId: created.id, response: 'accept' }),
        callerCleo.intros.respond({ introRequestId: created.id, response: 'decline' }),
      ]);

      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
      const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
      expect(rejected?.status === 'rejected' ? observe(rejected.reason).applicationCode : null).toBe(
        'INTRO_UNAVAILABLE',
      );
      expect(await outboxRows()).toHaveLength(3);
    });

    it('refuses an answer to an open request and to one the via declined, identically', async () => {
      const { alice, bruno, cleo, cass, dana } = await seedSymmetricWorld();
      const { callerFor } = makeCallers();
      const callerAlice = await callerFor(alice.authUserId);
      const callerBruno = await callerFor(bruno.authUserId);

      // Still open — nobody has passed it on, so the target has been told nothing.
      const open = await callerAlice.intros.request({
        targetUserId: cleo.userId,
        viaUserId: bruno.userId,
        note: NOTE,
      });
      // Declined by the via — the target must never learn it existed.
      const viaDeclined = await callerAlice.intros.request({
        targetUserId: cass.userId,
        viaUserId: bruno.userId,
        note: NOTE,
      });
      await callerBruno.intros.decide({ introRequestId: viaDeclined.id, decision: 'decline' });

      const refusals: ObservedRefusal[] = [
        await refusalOf(
          async () =>
            (await callerFor(cleo.authUserId)).intros.respond({
              introRequestId: open.id,
              response: 'accept',
            }),
          'answering an introduction that was never passed on',
        ),
        await refusalOf(
          async () =>
            (await callerFor(cass.authUserId)).intros.respond({
              introRequestId: viaDeclined.id,
              response: 'accept',
            }),
          'answering an introduction the via declined',
        ),
        // The control that makes the two above mean something: an id naming nothing.
        await refusalOf(
          async () =>
            (await callerFor(dana.authUserId)).intros.respond({
              introRequestId: randomUUID(),
              response: 'accept',
            }),
          'answering an introduction that does not exist',
        ),
      ];

      // ⚠ **One element, and the second refusal is why this matters most.** If "the via
      // declined it" answered differently from "there is no such introduction", a target
      // could detect a decline simply by trying to accept — which is precisely the
      // indistinguishability that makes declining safe for the via (ADR-0002 §10, B17).
      expect(new Set(refusals.map((refusal) => JSON.stringify(refusal))).size).toBe(1);
      expect(refusals[0]?.applicationCode).toBe('INTRO_UNAVAILABLE');

      const stored = await introRequestRows();
      expect(stored.map((row) => row.status).sort()).toEqual(['declined', 'requested']);
      expect(stored.every((row) => row.responded_at === null)).toBe(true);
    });
  });

  describe('Scenario: A target’s answer is the target’s to disclose (@integration, #166, AC3)', () => {
    it('reads a decline and an unanswered introduction identically on the requester’s record', async () => {
      const { alice, bruno, cleo, dana } = await seedSymmetricWorld();
      const { callerFor } = makeCallers();
      const callerAlice = await callerFor(alice.authUserId);
      const callerBruno = await callerFor(bruno.authUserId);
      const callerCleo = await callerFor(cleo.authUserId);

      const toCleo = await callerAlice.intros.request({
        targetUserId: cleo.userId,
        viaUserId: bruno.userId,
        note: NOTE,
      });
      const toDana = await callerAlice.intros.request({
        targetUserId: dana.userId,
        viaUserId: bruno.userId,
        note: NOTE,
      });
      await callerBruno.intros.decide(passOn(toCleo.id));
      await callerBruno.intros.decide(passOn(toDana.id));

      await callerCleo.intros.respond({ introRequestId: toCleo.id, response: 'decline' });

      const outbox = await callerAlice.intros.listOutbox();

      /**
       * Everything but what two different introductions are *allowed* to differ in.
       *
       * `decidedAt` is set aside with the id, the person and the creation time because the
       * two pass-ons were two separate writes at two separate moments — a difference about
       * the *via*, which both rows are entitled to report. The comparison is still total
       * over everything else, including any key one row grew and the other did not, which
       * is where a leaked `respondedAt` or a `target_declined` status would land.
       */
      function comparable(row: (typeof outbox)[number] | undefined): unknown {
        if (row === undefined) {
          throw new Error('the requester’s record is missing a row it must carry');
        }

        const {
          id: _id,
          targetUserId: _targetUserId,
          createdAt: _createdAt,
          decidedAt: _decidedAt,
          ...rest
        } = row;

        return rest;
      }

      const refused = outbox.find((row) => row.id === toCleo.id);

      // The set-aside fields are set aside, not missing: both rows report when the via
      // decided, so dropping `decidedAt` from the comparison hides no absence.
      expect(outbox.every((row) => row.decidedAt !== undefined)).toBe(true);

      // ⚠ **Byte-for-byte identical once the id and the person are set aside.** The same
      // rule that keeps a via's decline invisible to the target, one person along:
      // somebody who can be seen refusing cannot safely refuse. A status, a timestamp, or
      // an extra key on one of these two rows is enough to tell them apart.
      expect(comparable(refused)).toEqual(
        comparable(outbox.find((row) => row.id === toDana.id)),
      );
      expect(refused?.status).toBe('passed_on');
      expect(Object.keys(refused ?? {})).not.toContain('respondedAt');

      // The control of the control: the read is not empty everywhere, and it still says
      // the via passed both on.
      expect(outbox).toHaveLength(2);
      expect(outbox.every((row) => row.via?.userId === bruno.userId)).toBe(true);
    });

    it('reads an acceptance the same way — it discloses itself by connecting instead', async () => {
      const { alice, bruno, cleo, dana } = await seedSymmetricWorld();
      const { callerFor } = makeCallers();
      const callerAlice = await callerFor(alice.authUserId);
      const callerBruno = await callerFor(bruno.authUserId);
      const callerCleo = await callerFor(cleo.authUserId);

      const toCleo = await callerAlice.intros.request({
        targetUserId: cleo.userId,
        viaUserId: bruno.userId,
        note: NOTE,
      });
      const toDana = await callerAlice.intros.request({
        targetUserId: dana.userId,
        viaUserId: bruno.userId,
        note: NOTE,
      });
      await callerBruno.intros.decide(passOn(toCleo.id));
      await callerBruno.intros.decide(passOn(toDana.id));

      await callerCleo.intros.respond({ introRequestId: toCleo.id, response: 'accept' });
      await deliverEveryEventTo(introducedPairConsumer());

      // ⚠ The requester's own record says nothing about the answer even when the answer
      // was yes — the read is uniform, so it cannot be read backwards to find the noes.
      // What tells them is the connection, which is the target's own act.
      const outbox = await callerAlice.intros.listOutbox();
      expect(outbox.find((row) => row.id === toCleo.id)?.status).toBe('passed_on');
      expect(JSON.stringify(outbox)).not.toContain('accepted');
      expect(await connectionsBetween(alice.userId, cleo.userId)).toHaveLength(1);
      // The one nobody answered stays unconnected, so the read above is uniform because
      // the rule is uniform rather than because nothing happened.
      expect(await connectionsBetween(alice.userId, dana.userId)).toEqual([]);
    });
  });

  describe('Scenario: Connecting from an introduction happens once, however often delivered (@integration, #166, AC2)', () => {
    it('writes one connection and one ConnectionAccepted across a redelivery', async () => {
      const { alice, bruno, cleo } = await seedSymmetricWorld();
      const { callerFor } = makeCallers();
      const callerAlice = await callerFor(alice.authUserId);
      const callerBruno = await callerFor(bruno.authUserId);
      const callerCleo = await callerFor(cleo.authUserId);

      const created = await callerAlice.intros.request({
        targetUserId: cleo.userId,
        viaUserId: bruno.userId,
        note: NOTE,
      });
      await callerBruno.intros.decide(passOn(created.id));
      await callerCleo.intros.respond({ introRequestId: created.id, response: 'accept' });

      const consumer = introducedPairConsumer();
      await deliverEveryEventTo(consumer);
      // ⚠ At-least-once is the guarantee, so a second delivery is an ordinary event rather
      // than an error. The receipt is what makes it a no-op — inserted first, so the
      // unique violation abandons the transaction before the connection insert is even
      // attempted.
      await deliverEveryEventTo(consumer);

      expect(await connectionsBetween(alice.userId, cleo.userId)).toHaveLength(1);
      expect(
        (await outboxRows()).filter((event) => event.event_type === 'ConnectionAccepted'),
      ).toHaveLength(1);

      const { rows: receipts } = await testDatabase.client.query<{ count: string }>(
        `select count(*)::text as count from app.consumer_receipts
          where consumer_name = 'ConnectIntroducedPairHandler'`,
      );
      expect(receipts[0]?.count).toBe('1');
    });

    it('adds no second row when the pair is already connected', async () => {
      const { alice, bruno, cleo } = await seedSymmetricWorld();
      const { callerFor } = makeCallers();
      const callerAlice = await callerFor(alice.authUserId);
      const callerBruno = await callerFor(bruno.authUserId);
      const callerCleo = await callerFor(cleo.authUserId);

      const created = await callerAlice.intros.request({
        targetUserId: cleo.userId,
        viaUserId: bruno.userId,
        note: NOTE,
      });
      await callerBruno.intros.decide(passOn(created.id));
      await callerCleo.intros.respond({ introRequestId: created.id, response: 'accept' });

      const consumer = introducedPairConsumer();
      await deliverEveryEventTo(consumer);

      // A *different* event for the same pair — a distinct receipt, so the receipt gate
      // cannot be what saves this. What does is the insert's `on conflict do nothing`, and
      // the absence of a second `ConnectionAccepted` is the proof that no new fact was
      // announced for something that had already happened.
      const secondEventId = randomUUID();
      await testDatabase.client.query(
        `insert into app.outbox_events
           (event_id, event_type, occurred_at, actor_id, aggregate_id, payload)
         values ($1, 'IntroAccepted', now(), $2, $3, $4::jsonb)`,
        [
          secondEventId,
          cleo.userId,
          created.id,
          JSON.stringify({
            introRequestId: created.id,
            requesterId: alice.userId,
            viaId: bruno.userId,
            targetId: cleo.userId,
          }),
        ],
      );

      await deliverEveryEventTo(consumer);

      expect(await connectionsBetween(alice.userId, cleo.userId)).toHaveLength(1);
      expect(
        (await outboxRows()).filter((event) => event.event_type === 'ConnectionAccepted'),
      ).toHaveLength(1);
      // The receipt for the second delivery still lands: it *was* processed, and the
      // outcome was "nothing to do".
      const { rows: receipts } = await testDatabase.client.query<{ count: string }>(
        `select count(*)::text as count from app.consumer_receipts
          where consumer_name = 'ConnectIntroducedPairHandler'`,
      );
      expect(receipts[0]?.count).toBe('2');
    });
  });

  describe('Scenario: An invalid note is refused before eligibility is considered (@integration, #89, AC12)', () => {
    it('answers INTRO_CONTENT_INVALID for an unreachable target, never INTRO_UNAVAILABLE', async () => {
      const { alice, bruno, cleo } = await seedSymmetricWorld();
      const { callerFor } = makeCallers();
      const callerAlice = await callerFor(alice.authUserId);

      for (const note of ['', '   ', 'x'.repeat(INTRO_NOTE_MAX_LENGTH + 1)]) {
        // A reachable target: the ordinary content refusal.
        await expect(
          callerAlice.intros.request({
            targetUserId: cleo.userId,
            viaUserId: bruno.userId,
            note,
          }),
        ).rejects.toMatchObject({
          code: 'BAD_REQUEST',
          cause: expect.objectContaining({ code: 'INTRO_CONTENT_INVALID' }),
        });

        // ⚠ And an *unreachable* one: still `INTRO_CONTENT_INVALID`. Were eligibility
        // checked first, a caller could probe who is reachable by sending deliberate
        // rubbish and reading which refusal came back — the oracle
        // `INTRO_UNAVAILABLE` exists to close, reopened by an ordering nobody would think
        // to look at.
        await expect(
          callerAlice.intros.request({
            targetUserId: randomUUID(),
            viaUserId: randomUUID(),
            note,
          }),
        ).rejects.toMatchObject({
          code: 'BAD_REQUEST',
          cause: expect.objectContaining({ code: 'INTRO_CONTENT_INVALID' }),
        });
      }

      expect(await introRequestRows()).toEqual([]);
      expect(await outboxRows()).toEqual([]);
    });
  });

  describe('Scenario: Events ride the same transaction and carry no note (@integration, #89, AC13, ADR-0006)', () => {
    it('writes IntroRequested, IntroPassedOn and IntroDeclined with identifiers only', async () => {
      const { alice, bruno, cleo, cass } = await seedSymmetricWorld();
      const { callerFor } = makeCallers();
      const callerAlice = await callerFor(alice.authUserId);
      const callerBruno = await callerFor(bruno.authUserId);

      const toCleo = await callerAlice.intros.request({
        targetUserId: cleo.userId,
        viaUserId: bruno.userId,
        note: NOTE,
      });
      await callerBruno.intros.decide(passOn(toCleo.id));

      const toCass = await callerAlice.intros.request({
        targetUserId: cass.userId,
        viaUserId: bruno.userId,
        note: NOTE,
      });
      await callerBruno.intros.decide({ introRequestId: toCass.id, decision: 'decline' });

      const events = await outboxRows();
      expect(events.map((event) => event.event_type).sort()).toEqual([
        'IntroDeclined',
        'IntroPassedOn',
        'IntroRequested',
        'IntroRequested',
      ]);

      const requested = events.find(
        (event) => event.event_type === 'IntroRequested' && event.aggregate_id === toCleo.id,
      );
      expect(requested?.actor_id).toBe(alice.userId);
      expect(requested?.payload).toEqual({
        introRequestId: toCleo.id,
        requesterId: alice.userId,
        viaId: bruno.userId,
        targetId: cleo.userId,
      });

      // The via is the actor on both decisions — the requester never decides.
      expect(
        events.find((event) => event.event_type === 'IntroPassedOn')?.actor_id,
      ).toBe(bruno.userId);
      expect(events.find((event) => event.event_type === 'IntroDeclined')?.actor_id).toBe(
        bruno.userId,
      );

      // ⚠ The whole rows, not just the payloads. An outbox row is durable and widely
      // read; a consumer re-reads the note through this module's authorized reads or it
      // does not get it at all (M2-AC16, PDF §6).
      expect(JSON.stringify(events)).not.toContain(DISTINCTIVE_PHRASE);
      // ⚠ **And the via's vouch, which is the one a consumer would most want** (#175):
      // "someone you know passed an intro on and said this" is exactly the push body
      // nobody may build, because the outbox outlives the visibility state that allowed
      // it. The row carries the identifiers; the words stay behind the authorized read.
      expect(JSON.stringify(events)).not.toContain(DISTINCTIVE_VIA_PHRASE);
    });

    it('leaves neither the row nor the event when the event write fails', async () => {
      const { alice, bruno, cleo } = await seedSymmetricWorld();
      const { callerFor } = makeCallers();
      const callerAlice = await callerFor(alice.authUserId);

      // A forced failure *after* the state write, inside the same transaction. The
      // constraint is on the outbox rather than on the intro table on purpose: the insert
      // has already succeeded by the time this fires, so a green assertion below is
      // evidence of a rollback rather than of a refusal.
      await testDatabase.client.query(
        `alter table app.outbox_events
           add constraint outbox_events_forced_failure check (event_type not like 'Intro%')`,
      );

      try {
        await expect(
          callerAlice.intros.request({
            targetUserId: cleo.userId,
            viaUserId: bruno.userId,
            note: NOTE,
          }),
        ).rejects.toThrow();

        expect(await introRequestRows()).toEqual([]);
        expect(await outboxRows()).toEqual([]);
      } finally {
        await testDatabase.client.query(
          `alter table app.outbox_events drop constraint outbox_events_forced_failure`,
        );
      }

      // And the same write succeeds once the forced failure is gone, so the assertion
      // above was about atomicity rather than about a permanently broken path.
      await expect(
        callerAlice.intros.request({
          targetUserId: cleo.userId,
          viaUserId: bruno.userId,
          note: NOTE,
        }),
      ).resolves.toBeDefined();
      expect(await introRequestRows()).toHaveLength(1);
      expect(await outboxRows()).toHaveLength(1);
    });
  });

  describe('Scenario: No log line carries the note (@integration, #89, AC14)', () => {
    it('captures the request, the pass-on and the decline without the note reaching a line', async () => {
      const { alice, bruno, cleo, cass } = await seedSymmetricWorld();
      const { logger, lines } = capturingLogger();
      const { callerFor } = makeCallers(logger);
      const callerAlice = await callerFor(alice.authUserId);
      const callerBruno = await callerFor(bruno.authUserId);

      const toCleo = await callerAlice.intros.request({
        targetUserId: cleo.userId,
        viaUserId: bruno.userId,
        note: NOTE,
      });
      await callerBruno.intros.decide(passOn(toCleo.id));

      const toCass = await callerAlice.intros.request({
        targetUserId: cass.userId,
        viaUserId: bruno.userId,
        note: NOTE,
      });
      await callerBruno.intros.decide({ introRequestId: toCass.id, decision: 'decline' });

      // ⚠ **The control of the control.** A capture that received nothing satisfies "no
      // line contains the note" forever while proving nothing — the vacuous-green shape
      // this repository designs against. One deliberate line through the same logger and
      // the same destination is what makes the assertion below evidence.
      logger.info({ correlationId: 'intro-log-capture-probe' }, 'log capture probe');
      expect(lines.some((line) => line.includes('log capture probe'))).toBe(true);

      expect(lines.join('\n')).not.toContain(DISTINCTIVE_PHRASE);
      // Both notes, for the reason the two phrases exist: a logger that redacted the ask
      // and printed the vouch would pass the single-phrase version of this forever.
      expect(lines.join('\n')).not.toContain(DISTINCTIVE_VIA_PHRASE);
    });
  });

  describe("Scenario: The requester's own record carries every state and no note (@integration, #89, AC25)", () => {
    it('lists requested, passed_on and declined with the via projected on each', async () => {
      const { alice, bruno, cleo, cass, dana } = await seedSymmetricWorld();
      const { callerFor } = makeCallers();
      const callerAlice = await callerFor(alice.authUserId);
      const callerBruno = await callerFor(bruno.authUserId);

      const toCleo = await callerAlice.intros.request({
        targetUserId: cleo.userId,
        viaUserId: bruno.userId,
        note: NOTE,
      });
      await callerBruno.intros.decide(passOn(toCleo.id));

      const toCass = await callerAlice.intros.request({
        targetUserId: cass.userId,
        viaUserId: bruno.userId,
        note: NOTE,
      });
      await callerBruno.intros.decide({ introRequestId: toCass.id, decision: 'decline' });

      // Left open, so all three states are present at once.
      await callerAlice.intros.request({
        targetUserId: dana.userId,
        viaUserId: bruno.userId,
        note: NOTE,
      });

      const outbox = await callerAlice.intros.listOutbox();
      expect(outbox).toHaveLength(3);
      expect(
        Object.fromEntries(outbox.map((row) => [row.targetUserId, row.status])),
      ).toEqual({
        [cleo.userId]: 'passed_on',
        [cass.userId]: 'declined',
        [dana.userId]: 'requested',
      });

      for (const row of outbox) {
        // "Intro pending via {name}" needs the name, and the name comes from the
        // projection rather than from anything the client remembers.
        expect(row.via?.userId).toBe(bruno.userId);
        expect(row.via?.displayName).toBe(bruno.handle);
        // ⚠ No note, and no reason on the declined row: the requester wrote the first and
        // is not owed the second.
        expect(JSON.stringify(row)).not.toContain(DISTINCTIVE_PHRASE);
        expect(Object.keys(row)).not.toContain('note');
        // ⚠ **And no via note on the passed-on row** (#175), which is a stronger rule
        // than the one above rather than the same one twice: the via wrote those words to
        // the target, *about* the requester. Showing them here would turn a vouch into
        // something the person being vouched for reads over the writer's shoulder, and
        // nobody writes an honest one twice.
        expect(JSON.stringify(row)).not.toContain(DISTINCTIVE_VIA_PHRASE);
        expect(Object.keys(row)).not.toContain('viaNote');
      }

      const open = outbox.find((row) => row.status === 'requested');
      expect(open?.decidedAt).toBeUndefined();
      expect(outbox.find((row) => row.status === 'declined')?.decidedAt).toBeDefined();
    });
  });
});

function contextFor(
  authorizationHeader: string | undefined,
  dependencies: Parameters<typeof authenticateRequest>[1],
  logger?: Logger,
): RequestContext {
  let outcome: ReturnType<typeof authenticateRequest> | undefined;
  return {
    correlationId: 'correlation-id-for-test',
    logger: logger ?? createLogger({ level: 'silent' }),
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

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

import { authenticateRequest } from '../../../../shared/auth/authenticate-request';
import { createSupabaseJwtVerifier } from '../../../../shared/auth/supabase-jwt-verifier';
import type { RequestContext } from '../../../../shared/trpc/request-context';
import { createCallerFactory, router } from '../../../../shared/trpc/trpc';
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
 */
describe('request an intro (request-an-intro.feature, #89)', () => {
  let testDatabase: PostgresTestDatabase;
  let database: DatabaseConnection;
  let signingKey: SupabaseSigningKeyPair;

  /** Distinctive enough that finding it anywhere is evidence rather than coincidence. */
  const DISTINCTIVE_PHRASE = 'obsidian-marigold-thunderhead';
  const NOTE = `We should talk about the ${DISTINCTIVE_PHRASE}.`;

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
    readonly status: string;
    readonly decided_at: Date | null;
  }

  async function introRequestRows(): Promise<readonly StoredIntroRequest[]> {
    const { rows } = await testDatabase.client.query<StoredIntroRequest>(
      `select id, requester_id, via_id, target_id, note, status, decided_at
         from app.intro_requests order by created_at, id`,
    );
    return rows;
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
            async () => caller.intros.decide({ introRequestId: created.id, decision: 'pass_on' }),
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
            callerBruno.intros.decide({ introRequestId: randomUUID(), decision: 'pass_on' }),
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
      const decided = await callerBruno.intros.decide({
        introRequestId: created.id,
        decision: 'pass_on',
      });
      expect(decided.status).toBe('passed_on');
      expect(decided.decidedAt).toBeDefined();

      for (const decision of ['pass_on', 'decline'] as const) {
        await expect(
          callerBruno.intros.decide({ introRequestId: created.id, decision }),
        ).rejects.toMatchObject({
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
        callerBruno.intros.decide({ introRequestId: created.id, decision: 'pass_on' }),
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
        callerBruno.intros.decide({ introRequestId: created.id, decision: 'pass_on' }),
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
        callerBruno.intros.decide({ introRequestId: created.id, decision: 'pass_on' }),
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

      await callerBruno.intros.decide({ introRequestId: created.id, decision: 'pass_on' });

      const forCleo = await callerCleo.intros.listInbox();
      expect(forCleo).toHaveLength(1);
      expect(forCleo[0]?.role).toBe('target');
      expect(forCleo[0]?.note).toBe(NOTE);
      expect(forCleo[0]?.requester?.userId).toBe(alice.userId);
      expect(forCleo[0]?.requester?.displayName).toBe(alice.handle);
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
      await callerBruno.intros.decide({ introRequestId: created.id, decision: 'pass_on' });

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
      await callerBruno.intros.decide({ introRequestId: created.id, decision: 'pass_on' });

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
      await callerBruno.intros.decide({ introRequestId: created.id, decision: 'pass_on' });
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
      await callerBruno.intros.decide({ introRequestId: toCleo.id, decision: 'pass_on' });

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
      await callerBruno.intros.decide({ introRequestId: toCleo.id, decision: 'pass_on' });

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
      await callerBruno.intros.decide({ introRequestId: toCleo.id, decision: 'pass_on' });

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

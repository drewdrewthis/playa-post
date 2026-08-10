import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { startPostgresTestDatabase, type PostgresTestDatabase } from '@playa-post/testing';

/**
 * `app.intro_via_candidates` — the eligibility rule itself (issue #89, ACs 16 and 17).
 *
 * Called directly against the installed function rather than through the router,
 * because what is under test is the *set semantics*: which triples are eligible, and —
 * far more importantly — which are not. A suite that only exercised it through
 * `intros.request` would confirm the refusal without ever showing which of the several
 * reasons produced it, and a rule whose failure modes are indistinguishable to the
 * caller has to be distinguishable to its own tests.
 *
 * ⚠ Every negative below asserts an **empty set**, never an error. That is the shape of
 * the whole feature's privacy property: "at degree 1", "three hops away", "hidden by
 * their own setting", "deactivated", "nobody at all" and "that is you" must all be one
 * answer by the time a caller sees it (ADR-0002 §10).
 */
describe('app.intro_via_candidates(requester_id, target_id) — issue #89', () => {
  let database: PostgresTestDatabase;

  beforeAll(async () => {
    database = await startPostgresTestDatabase();
  }, 300_000);

  afterEach(async () => {
    await database.truncateAllTables();
  });

  afterAll(async () => {
    await database?.stop();
  });

  async function seedUser(handle: string): Promise<string> {
    const { rows } = await database.client.query<{ id: string }>(
      `insert into app.users (auth_user_id, handle, display_name, created_at)
       values (pg_catalog.gen_random_uuid(), $1, $2, now()) returning id`,
      [handle, handle],
    );
    const id = rows[0]?.id;
    if (id === undefined) {
      throw new Error(`seedUser(${handle}): insert returned no row`);
    }
    return id;
  }

  /**
   * @param aDisclosesToB - what `userAId` grants `userBId`; `limited` is what makes
   *   `app.visible_people` withhold A's name from B (ADR-0004 decision 3).
   */
  async function connect(
    userAId: string,
    userBId: string,
    aDisclosesToB: 'full' | 'limited' = 'full',
  ): Promise<void> {
    await database.client.query(
      `insert into app.connections
         (user_a_id, user_b_id, status, a_discloses_to_b_level, b_discloses_to_a_level, created_at)
       values ($1, $2, 'accepted', $3, 'full', now())`,
      [userAId, userBId, aDisclosesToB],
    );
  }

  async function setReach(
    userId: string,
    distance: 'first' | 'second' | 'third' | 'sixth',
  ): Promise<void> {
    await database.client.query(`update app.users set visible_to_distance = $2 where id = $1`, [
      userId,
      distance,
    ]);
  }

  /** ADR-0002 B11's lifecycle: `app.visible_people` prunes anyone not `active`. */
  async function deactivate(userId: string): Promise<void> {
    await database.client.query(
      `update app.users set status = 'deactivated', deactivated_at = now() where id = $1`,
      [userId],
    );
  }

  interface CandidateRow {
    readonly via_id: string;
    readonly disclosure: string;
    readonly display_name: string | null;
    readonly handle: string | null;
  }

  async function candidatesFor(
    requesterId: string,
    targetId: string,
  ): Promise<readonly CandidateRow[]> {
    const { rows } = await database.client.query<CandidateRow>(
      `select via_id, disclosure, display_name, handle
         from app.intro_via_candidates($1, $2)`,
      [requesterId, targetId],
    );
    return rows;
  }

  describe('the eligible shape: A—B—C, with C at exactly two hops', () => {
    it('returns B, and only B', async () => {
      const alice = await seedUser('dusty_via_ok_a');
      const bruno = await seedUser('dusty_via_ok_b');
      const cleo = await seedUser('dusty_via_ok_c');
      // A fourth person A knows, who does not know C — a real first-degree connection
      // that is nonetheless not a candidate. Without them this test would pass against a
      // function that returned every one of A's connections.
      const dot = await seedUser('dusty_via_ok_d');
      await connect(alice, bruno);
      await connect(bruno, cleo);
      await connect(alice, dot);

      const candidates = await candidatesFor(alice, cleo);

      expect(candidates.map((row) => row.via_id)).toEqual([bruno]);
    });

    it('returns every shared connection when there are several, in a stable order', async () => {
      const alice = await seedUser('dusty_via_two_a');
      const bruno = await seedUser('dusty_via_two_b');
      const bex = await seedUser('dusty_via_two_b2');
      const cleo = await seedUser('dusty_via_two_c');
      await connect(alice, bruno);
      await connect(alice, bex);
      await connect(bruno, cleo);
      await connect(bex, cleo);

      const candidates = await candidatesFor(alice, cleo);

      expect([...candidates].map((row) => row.via_id).sort()).toEqual([bruno, bex].sort());
      // Ordered inside the function, so two reads agree and a client can render chips
      // without sorting.
      expect(candidates.map((row) => row.via_id)).toEqual(
        [...candidates].map((row) => row.via_id).sort(),
      );
    });

    it('projects the candidate through §6a — a via who discloses only limited arrives unnamed', async () => {
      const alice = await seedUser('dusty_via_limited_a');
      const bruno = await seedUser('dusty_via_limited_b');
      const cleo = await seedUser('dusty_via_limited_c');
      // B grants A only `limited`, so B is on A's graph as a nameless node.
      await connect(bruno, alice, 'limited');
      await connect(bruno, cleo);

      const [candidate] = await candidatesFor(alice, cleo);

      expect(candidate?.via_id).toBe(bruno);
      expect(candidate?.disclosure).toBe('topology_only');
      // ⚠ The columns are not projected at all, so there is nothing above the database
      // that could forget to strip them — and the chip renders with no name rather than
      // with initials or a truncated id.
      expect(candidate?.display_name).toBeNull();
      expect(candidate?.handle).toBeNull();
    });
  });

  describe('the ineligible shapes — every one an empty set, none an error', () => {
    it('returns nothing for a target who is already a direct connection', async () => {
      const alice = await seedUser('dusty_via_first_a');
      const bruno = await seedUser('dusty_via_first_b');
      await connect(alice, bruno);

      expect(await candidatesFor(alice, bruno)).toEqual([]);
    });

    it('returns nothing for a target three hops away', async () => {
      const alice = await seedUser('dusty_via_third_a');
      const bruno = await seedUser('dusty_via_third_b');
      const cleo = await seedUser('dusty_via_third_c');
      const dot = await seedUser('dusty_via_third_d');
      await connect(alice, bruno);
      await connect(bruno, cleo);
      await connect(cleo, dot);

      // D is visible to A — the depth cap is gone — and is still not introducible. An
      // intro travels one hop; a chain is a thing nobody in it agreed to.
      expect(await candidatesFor(alice, dot)).toEqual([]);
    });

    it('returns nothing for a target nobody has ever connected to the requester', async () => {
      const alice = await seedUser('dusty_via_stranger_a');
      const stranger = await seedUser('dusty_via_stranger_z');

      expect(await candidatesFor(alice, stranger)).toEqual([]);
    });

    it('returns nothing for a UUID naming nobody — the same answer a real stranger gets', async () => {
      const alice = await seedUser('dusty_via_nobody_a');

      expect(await candidatesFor(alice, randomUUID())).toEqual([]);
    });

    it('returns nothing when the requester names themselves', async () => {
      const alice = await seedUser('dusty_via_self_a');
      const bruno = await seedUser('dusty_via_self_b');
      await connect(alice, bruno);

      // Needs no separate gate: nobody is at degree 2 of themselves, so the same
      // predicate that refuses a stranger refuses this.
      expect(await candidatesFor(alice, alice)).toEqual([]);
    });

    it("returns nothing when the target's own reach setting puts the requester too far away", async () => {
      const alice = await seedUser('dusty_via_reach_a');
      const bruno = await seedUser('dusty_via_reach_b');
      const cleo = await seedUser('dusty_via_reach_c');
      await connect(alice, bruno);
      await connect(bruno, cleo);

      // C says only direct connections may see they exist. A is two hops away, so C is
      // not on A's graph at all — and a person you cannot see cannot be introduced to
      // you, for free, because the eligibility function composes the same projection.
      await setReach(cleo, 'first');

      expect(await candidatesFor(alice, cleo)).toEqual([]);
    });

    it('returns nothing for a deactivated target', async () => {
      const alice = await seedUser('dusty_via_gone_a');
      const bruno = await seedUser('dusty_via_gone_b');
      const cleo = await seedUser('dusty_via_gone_c');
      await connect(alice, bruno);
      await connect(bruno, cleo);
      await deactivate(cleo);

      expect(await candidatesFor(alice, cleo)).toEqual([]);
    });

    it('returns nothing when the only person standing between them is withheld (AC17)', async () => {
      const alice = await seedUser('dusty_via_hidden_a');
      const bruno = await seedUser('dusty_via_hidden_b');
      const cleo = await seedUser('dusty_via_hidden_c');
      await connect(alice, bruno);
      await connect(bruno, cleo);
      // B deactivates. `app.visible_people` still *routes* through them — that is what
      // keeps one person's absence from disconnecting everybody else — so C remains at
      // degree 2 of A and stays on A's graph. But B is not a row, so there is nobody left
      // to ask.
      await deactivate(bruno);

      const targetStillVisible = await database.client.query<{ degree: number }>(
        `select degree from app.visible_people($1) where user_id = $2`,
        [alice, cleo],
      );
      expect(
        targetStillVisible.rows[0]?.degree,
        'the scenario is only meaningful while the target is still visible at degree 2',
      ).toBe(2);

      // The sheet must render a no-candidates state with submit disabled — never an empty
      // chip row above an enabled button.
      expect(await candidatesFor(alice, cleo)).toEqual([]);
    });

    it('returns nothing for a first-degree connection who does not know the target', async () => {
      const alice = await seedUser('dusty_via_unshared_a');
      const bruno = await seedUser('dusty_via_unshared_b');
      const cleo = await seedUser('dusty_via_unshared_c');
      const dot = await seedUser('dusty_via_unshared_d');
      await connect(alice, bruno);
      await connect(bruno, cleo);
      // D is a genuine first-degree connection of A and knows nobody else.
      await connect(alice, dot);

      expect((await candidatesFor(alice, cleo)).map((row) => row.via_id)).not.toContain(dot);
    });

    it('returns nothing when the shared person is only pending, never accepted', async () => {
      const alice = await seedUser('dusty_via_pending_a');
      const bruno = await seedUser('dusty_via_pending_b');
      const cleo = await seedUser('dusty_via_pending_c');
      await connect(alice, bruno);
      await database.client.query(
        `insert into app.connections
           (user_a_id, user_b_id, status, a_discloses_to_b_level, b_discloses_to_a_level, created_at)
         values ($1, $2, 'pending', 'full', 'full', now())`,
        [bruno, cleo],
      );

      // An unaccepted connection is not a connection. `app.visible_people`'s `edge` CTE
      // filters on `status = 'accepted'`, and composing it is what gives this function
      // that rule without restating it.
      expect(await candidatesFor(alice, cleo)).toEqual([]);
    });

    it('excludes a deactivated candidate while still returning the live one', async () => {
      const alice = await seedUser('dusty_via_mixed_a');
      const bruno = await seedUser('dusty_via_mixed_b');
      const bex = await seedUser('dusty_via_mixed_b2');
      const cleo = await seedUser('dusty_via_mixed_c');
      await connect(alice, bruno);
      await connect(alice, bex);
      await connect(bruno, cleo);
      await connect(bex, cleo);
      await deactivate(bex);

      // The person lifecycle arrives for free through the composition rather than through
      // a status filter written here (ADR-0002 B11) — which is the whole argument for
      // composing `app.visible_people` on the target side too.
      expect((await candidatesFor(alice, cleo)).map((row) => row.via_id)).toEqual([bruno]);
    });
  });

  describe('symmetry', () => {
    it('is not symmetric in its arguments — asking the other way round is a different question', async () => {
      const alice = await seedUser('dusty_via_sym_a');
      const bruno = await seedUser('dusty_via_sym_b');
      const cleo = await seedUser('dusty_via_sym_c');
      await connect(alice, bruno);
      await connect(bruno, cleo);

      // Both directions happen to be eligible here — A and C are each two hops from the
      // other through B — which is the honest statement of the rule rather than an
      // accident: an introduction has a direction (who asked), and eligibility does not.
      expect((await candidatesFor(alice, cleo)).map((row) => row.via_id)).toEqual([bruno]);
      expect((await candidatesFor(cleo, alice)).map((row) => row.via_id)).toEqual([bruno]);
    });
  });
});

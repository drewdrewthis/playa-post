import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseConnection, type DatabaseConnection } from '@playa-post/database';
import { startPostgresTestDatabase, type PostgresTestDatabase } from '@playa-post/testing';

// The real read path, not a hand-written query: `app.visible_people` is the one place
// disclosure is decided (ADR-0002 §6a), so a test that asked the question its own way
// would prove something about its own SQL rather than about the product.
//
// ⚠ Through `graph.module.ts`'s public `visiblePeople` — the §6a export every other
// consumer takes (lane-brief C8) — and never `graph/persistence/`, which
// `no-cross-module-persistence` forbids and `pnpm boundaries` fails the build on. The
// module barrel is the sanctioned seam precisely so a consumer gets the projected read
// model and no way to reach the SQL behind it.
import { createGraphModule, type VisiblePerson } from '../../../graph/graph.module';
import { createSetPrivacyLimitsService } from '../../application/set-privacy-limits.service';
import { createPostgresPrivacyLimitsRepository } from '../../persistence/postgres-privacy-limits.repository';

/**
 * "Who sees your name" — the You screen's first limit, enforced (issue #49).
 *
 * ⚠ **This is the suite that decides whether the setting is real.** A privacy control
 * that stores a value and changes nothing is worse than no control, so every assertion
 * here reads through `app.visible_people` and asserts on the projected `displayName`,
 * never on the row it wrote.
 *
 * The direction under test is the one that is easy to get backwards: the limit belongs to
 * the person being **looked at**, and the trust it compares is **theirs**, toward the
 * viewer. Owner tightens → viewer stops seeing owner's name. The mirror case (viewer's
 * own limit has no effect on what the viewer sees) is asserted explicitly for that reason.
 */
describe('the name limit gates disclosure in app.visible_people (issue #49)', () => {
  const APP_RW_TEST_PASSWORD = 'app_rw_in_a_throwaway_container';

  let testDatabase: PostgresTestDatabase;
  let database: DatabaseConnection;

  beforeAll(async () => {
    testDatabase = await startPostgresTestDatabase();
    await testDatabase.client.query(
      `alter role app_rw with password '${APP_RW_TEST_PASSWORD}'`,
    );
    database = createDatabaseConnection({
      connectionString: asRole(testDatabase.connectionString, 'app_rw', APP_RW_TEST_PASSWORD),
    });
  }, 300_000);

  afterEach(async () => {
    await testDatabase.truncateAllTables();
  });

  afterAll(async () => {
    await database?.destroy();
    await testDatabase?.stop();
  });

  async function seedUser(handle: string): Promise<string> {
    const { rows } = await testDatabase.client.query<{ id: string }>(
      `insert into app.users (auth_user_id, handle, display_name, created_at)
       values ($1, $2, $3, now()) returning id`,
      [randomUUID(), handle, handle],
    );
    const userId = rows[0]?.id;
    if (userId === undefined) {
      throw new Error('seedUser: insert returned no row');
    }
    return userId;
  }

  async function connect(a: string, b: string): Promise<void> {
    await testDatabase.client.query(
      `insert into app.connections
         (user_a_id, user_b_id, status, a_discloses_to_b_level, b_discloses_to_a_level, created_at)
       values ($1, $2, 'accepted', 'full', 'full', now())`,
      [a, b],
    );
  }

  /** `owner` privately rates `subject`. Directional, and never visible to `subject`. */
  async function rate(owner: string, subject: string, trust: number): Promise<void> {
    await testDatabase.client.query(
      `insert into app.connection_trust (owner_id, subject_id, trust, updated_at)
       values ($1, $2, $3, now())`,
      [owner, subject, trust],
    );
  }

  function setLimits() {
    return createSetPrivacyLimitsService({
      limits: createPostgresPrivacyLimitsRepository({ database }),
    });
  }

  /** Everyone `viewer` may see, exactly as every other consumer of §6a asks for them. */
  function peopleSeenBy(viewer: string): Promise<readonly VisiblePerson[]> {
    return createGraphModule({ database }).visiblePeople.listFor(viewer);
  }

  /**
   * What `viewer` can see about `subject`, through the canonical projection.
   *
   * ⚠ `undefined` is the withheld answer, not `null`. The mapper **omits** the identity
   * keys below `full` rather than nulling them (ADR-0002 §6a): a `null` says "there is a
   * name and you are not getting it", an absent key says "there is no name here", and the
   * second is the shape B5's person-projection sub-case measures. Asserting `toBeNull`
   * here would pass against a projection that had started leaking the key.
   */
  async function nameSeenBy(viewer: string, subject: string): Promise<string | undefined> {
    const people = await peopleSeenBy(viewer);
    return people.find((person) => person.userId === subject)?.displayName;
  }

  async function disclosureSeenBy(viewer: string, subject: string): Promise<string | undefined> {
    const people = await peopleSeenBy(viewer);
    return people.find((person) => person.userId === subject)?.disclosure;
  }

  /**
   * ⚠ The regression this migration is most likely to cause, asserted first. Nobody has a
   * `app.privacy_settings` row on a fresh database, and if the absent row read as
   * anything but permissive, every name in the product would vanish at once.
   */
  it('discloses as it always did when neither party has ever touched the screen', async () => {
    const rae = await seedUser('dusty_limit_rae');
    const moss = await seedUser('dusty_limit_moss');
    await connect(rae, moss);

    await expect(nameSeenBy(rae, moss)).resolves.toBe('dusty_limit_moss');
    await expect(nameSeenBy(moss, rae)).resolves.toBe('dusty_limit_rae');
  });

  it('still discloses when the owner has saved the permissive default explicitly', async () => {
    const rae = await seedUser('dusty_limit_rae2');
    const moss = await seedUser('dusty_limit_moss2');
    await connect(rae, moss);
    await setLimits().set({
      actorId: moss,
      limits: { name: { minTrust: null, maxDegree: 3 }, note: { minTrust: null, maxDegree: 3 } },
    });

    await expect(nameSeenBy(rae, moss)).resolves.toBe('dusty_limit_moss2');
  });

  describe('a trust floor', () => {
    it("withholds the owner's name from a connection they have never rated", async () => {
      const rae = await seedUser('dusty_floor_rae');
      const moss = await seedUser('dusty_floor_moss');
      await connect(rae, moss);

      await setLimits().set({
        actorId: moss,
        limits: { name: { minTrust: 50, maxDegree: 3 }, note: { minTrust: null, maxDegree: 3 } },
      });

      // Unset is not zero and not "below the bar by default" — it is NULL, and the
      // comparison fails closed (ADR-0004:70-71).
      await expect(nameSeenBy(rae, moss)).resolves.toBeUndefined();
      await expect(disclosureSeenBy(rae, moss)).resolves.toBe('topology_only');
    });

    it("discloses to a connection the owner rated at the floor", async () => {
      const rae = await seedUser('dusty_floor_rae2');
      const moss = await seedUser('dusty_floor_moss2');
      await connect(rae, moss);
      await rate(moss, rae, 50);

      await setLimits().set({
        actorId: moss,
        limits: { name: { minTrust: 50, maxDegree: 3 }, note: { minTrust: null, maxDegree: 3 } },
      });

      // At the floor, not merely above it: `>=`, so a person rated exactly 50 by an
      // owner who chose "TRUST 50+" is inside the limit.
      await expect(nameSeenBy(rae, moss)).resolves.toBe('dusty_floor_moss2');
    });

    it('withholds from a connection rated below the floor', async () => {
      const rae = await seedUser('dusty_floor_rae3');
      const moss = await seedUser('dusty_floor_moss3');
      await connect(rae, moss);
      await rate(moss, rae, 49);

      await setLimits().set({
        actorId: moss,
        limits: { name: { minTrust: 50, maxDegree: 3 }, note: { minTrust: null, maxDegree: 3 } },
      });

      await expect(nameSeenBy(rae, moss)).resolves.toBeUndefined();
    });

    /**
     * ⚠ **The direction check.** Trust is directional and private, so the floor must
     * compare the *owner's* trust in the viewer. If the join were keyed the other way,
     * this test would pass a name through on the strength of an opinion the owner never
     * held — and would leak the viewer's own private rating into the owner's policy.
     */
    it("compares the owner's trust in the viewer, not the viewer's trust in the owner", async () => {
      const rae = await seedUser('dusty_dir_rae');
      const moss = await seedUser('dusty_dir_moss');
      await connect(rae, moss);
      // Rae thinks the world of Moss. Moss has no opinion of Rae at all.
      await rate(rae, moss, 100);

      await setLimits().set({
        actorId: moss,
        limits: { name: { minTrust: 50, maxDegree: 3 }, note: { minTrust: null, maxDegree: 3 } },
      });

      await expect(nameSeenBy(rae, moss)).resolves.toBeUndefined();
    });

    /**
     * A limit is a statement about who may see *you*. Setting one must not change what
     * you can see — that would make the control a self-inflicted blindfold, and it is the
     * confusion a single shared column would have baked in.
     */
    it("does not change what the owner themselves can see", async () => {
      const rae = await seedUser('dusty_self_rae');
      const moss = await seedUser('dusty_self_moss');
      await connect(rae, moss);

      await setLimits().set({
        actorId: rae,
        limits: { name: { minTrust: 75, maxDegree: 1 }, note: { minTrust: 75, maxDegree: 1 } },
      });

      await expect(nameSeenBy(rae, moss)).resolves.toBe('dusty_self_moss');
      // And the owner still sees themselves, whatever they chose.
      await expect(nameSeenBy(rae, rae)).resolves.toBe('dusty_self_rae');
    });

    /**
     * `0` is a floor somebody chose; `null` is no floor at all. An owner who picks a
     * floor of zero still withholds from everyone they have never rated, because unset
     * trust is NULL.
     */
    it('treats a floor of 0 as a real requirement, not as ANYONE', async () => {
      const rae = await seedUser('dusty_zero_rae');
      const moss = await seedUser('dusty_zero_moss');
      const juno = await seedUser('dusty_zero_juno');
      await connect(rae, moss);
      await connect(juno, moss);
      await rate(moss, juno, 0);

      await setLimits().set({
        actorId: moss,
        limits: { name: { minTrust: 0, maxDegree: 3 }, note: { minTrust: null, maxDegree: 3 } },
      });

      await expect(nameSeenBy(rae, moss)).resolves.toBeUndefined();
      await expect(nameSeenBy(juno, moss)).resolves.toBe('dusty_zero_moss');
    });
  });

  describe('one person’s limit', () => {
    it('does not affect anybody else’s disclosure', async () => {
      const rae = await seedUser('dusty_other_rae');
      const moss = await seedUser('dusty_other_moss');
      const juno = await seedUser('dusty_other_juno');
      await connect(rae, moss);
      await connect(rae, juno);

      await setLimits().set({
        actorId: moss,
        limits: { name: { minTrust: 75, maxDegree: 3 }, note: { minTrust: null, maxDegree: 3 } },
      });

      await expect(nameSeenBy(rae, moss)).resolves.toBeUndefined();
      await expect(nameSeenBy(rae, juno)).resolves.toBe('dusty_other_juno');
    });

    /**
     * ⚠ Reachability is untouched by a limit — the person is still *there*, as an unnamed
     * node. That is the design's promise in as many words ("they know someone is there,
     * not who") and it is also what keeps `app.visible_edges`, which composes this
     * function for `user_id` alone, unaffected by anything in this file.
     */
    it('hides the name without removing the person from the graph', async () => {
      const rae = await seedUser('dusty_topo_rae');
      const moss = await seedUser('dusty_topo_moss');
      await connect(rae, moss);

      await setLimits().set({
        actorId: moss,
        limits: { name: { minTrust: 75, maxDegree: 3 }, note: { minTrust: null, maxDegree: 3 } },
      });

      const people = await peopleSeenBy(rae);

      expect(people.map((person) => person.userId)).toContain(moss);
      expect(people).toHaveLength(2);

      const { rows: edges } = await testDatabase.client.query<{ count: string }>(
        `select count(*)::text as count from app.visible_edges($1)`,
        [rae],
      );
      expect(edges[0]?.count, 'an edge is topology, and a name limit is not').toBe('1');
    });
  });

  /**
   * The note limit is stored and deliberately inert: `app.bulletins` has no recipient, so
   * there is no "pin to a board" to gate. Asserted so the day somebody wires the two
   * together, this test tells them the coupling is new rather than pre-existing.
   */
  it('leaves name disclosure alone when only the note limit is tightened', async () => {
    const rae = await seedUser('dusty_note_rae');
    const moss = await seedUser('dusty_note_moss');
    await connect(rae, moss);

    await setLimits().set({
      actorId: moss,
      limits: { name: { minTrust: null, maxDegree: 3 }, note: { minTrust: 75, maxDegree: 1 } },
    });

    await expect(nameSeenBy(rae, moss)).resolves.toBe('dusty_note_moss');
  });

  /**
   * ⚠ ADR-0002 B6, restated at this new seam. `app.visible_people` now reads a trust value
   * the viewer does not hold, to evaluate the owner's floor. It must be consumed as a
   * boolean and never projected — the `trust` column stays the viewer's own.
   */
  it("never projects the other person's trust, only the viewer's own", async () => {
    const rae = await seedUser('dusty_b6_rae');
    const moss = await seedUser('dusty_b6_moss');
    await connect(rae, moss);
    await rate(moss, rae, 90);
    await rate(rae, moss, 10);

    await setLimits().set({
      actorId: moss,
      limits: { name: { minTrust: 50, maxDegree: 3 }, note: { minTrust: null, maxDegree: 3 } },
    });

    const people = await peopleSeenBy(rae);
    const mossRow = people.find((person) => person.userId === moss);

    // Rae cleared Moss's floor, so the name is disclosed …
    expect(mossRow?.displayName).toBe('dusty_b6_moss');
    // … and the trust Rae reads is Rae's own 10, never Moss's 90.
    expect(mossRow?.trust).toBe(10);
  });
});

/** Re-point a `postgres://` URI at a different role, keeping host, port, and database. */
function asRole(connectionString: string, username: string, password: string): string {
  const url = new URL(connectionString);
  url.username = username;
  url.password = password;
  return url.toString();
}

import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseConnection, sql, type DatabaseConnection } from '@playa-post/database';
import { createLogger } from '@playa-post/observability';
import { startPostgresTestDatabase, type PostgresTestDatabase } from '@playa-post/testing';

import type { AuthenticationOutcome } from '../../../../shared/auth/authenticate-request';
import type { RequestContext } from '../../../../shared/trpc/request-context';
import { createCallerFactory, router } from '../../../../shared/trpc/trpc';
import { createIdentityModule } from '../../identity.module';
import { createPostgresUserRepository } from '../../persistence/postgres-user.repository';
import { DISPLAY_NAME_MAX_LENGTH } from '../../transport/display-name';

/**
 * `specs/features/edit-display-name.feature` — the `@integration` scenarios (issue
 * #177), against a real `app.users` and a real `app.visible_people`.
 *
 * **Driven through the module's own router**, not through the service, because the
 * authorization claim is a claim about the *transport*: `identity.updateDisplayName`
 * takes no identifier, so who is renamed is decided by the actor on the context and by
 * nothing a caller sends. A service-level test cannot make that claim — it is handed
 * the `userId` as an argument, which is the very thing under test.
 *
 * `app.visible_people` is queried with raw SQL rather than through the graph module,
 * for `visible-to-distance.integration.test.ts`'s reason: this suite is about the
 * column identity owns and the projection's contract with it, and
 * `no-cross-module-persistence` forbids reaching into graph's persistence. Tests are
 * outside `no-sql-outside-persistence`'s scope by design.
 */

/** Everything `authenticatedProcedure` puts on the context, and nothing more. */
interface Actor {
  readonly userId: string;
  readonly handle: string;
}

function contextForActor(actor: Actor): RequestContext {
  const outcome: AuthenticationOutcome = {
    kind: 'authenticated',
    principal: { authUserId: 'unused-in-this-suite' },
    actor,
  };

  return {
    correlationId: 'correlation-id-for-test',
    logger: createLogger({ level: 'silent' }),
    authentication: () => Promise.resolve(outcome),
  };
}

/** The module, wired the way `composition/container.ts` wires it. */
function wireIdentity(connection: DatabaseConnection) {
  const identityModule = createIdentityModule({ database: connection });
  const createCaller = createCallerFactory(router({ identity: identityModule.router }));

  return { callerFor: (actor: Actor) => createCaller(contextForActor(actor)) };
}

describe('editing your own display name (issue #177)', () => {
  let testDatabase: PostgresTestDatabase;
  let database: DatabaseConnection;

  beforeAll(async () => {
    testDatabase = await startPostgresTestDatabase();
    // Generated per run, never source-controlled: a literal here would trip secret
    // scanners even though the container is throwaway. A UUID is [0-9a-f-] only, so
    // interpolating it into ALTER ROLE (which cannot take a bind parameter) is safe.
    const appRwPassword = randomUUID();
    await testDatabase.client.query(`alter role app_rw with password '${appRwPassword}'`);
    database = createDatabaseConnection({
      connectionString: asRole(testDatabase.connectionString, 'app_rw', appRwPassword),
    });
  }, 300_000);

  afterEach(async () => {
    await testDatabase.truncateAllTables();
  });

  afterAll(async () => {
    await database?.destroy();
    await testDatabase?.stop();
  });

  /** A row seeded with the owner client — a fixture, never through the port under test. */
  async function seedUser(handle: string, displayName: string): Promise<Actor> {
    const { rows } = await testDatabase.client.query<{ id: string }>(
      `insert into app.users (auth_user_id, handle, display_name, created_at)
       values ($1, $2, $3, now()) returning id`,
      [randomUUID(), handle, displayName],
    );
    const id = rows[0]?.id;

    if (id === undefined) {
      throw new Error('seedUser: insert returned no row');
    }

    return { userId: id, handle };
  }

  async function connect(userAId: string, userBId: string): Promise<void> {
    await testDatabase.client.query(
      `insert into app.connections
         (user_a_id, user_b_id, status, a_discloses_to_b_level, b_discloses_to_a_level, created_at)
       values ($1, $2, 'accepted', 'full', 'full', now())`,
      [userAId, userBId],
    );
  }

  async function storedRow(
    userId: string,
  ): Promise<{ display_name: string; handle: string; version: number }> {
    const { rows } = await testDatabase.client.query<{
      display_name: string;
      handle: string;
      version: number;
    }>(`select display_name, handle, version from app.users where id = $1`, [userId]);
    const row = rows[0];

    if (row === undefined) {
      throw new Error(`storedRow: no app.users row for ${userId}`);
    }

    return row;
  }

  /**
   * What a viewer's own graph says about somebody, through the §6a projection.
   *
   * `undefined` means "not on this viewer's graph at all"; `null` means "on it, with
   * identity withheld". The two are different answers and this suite depends on the
   * difference.
   */
  async function nameSeenBy(
    viewerId: string,
    subjectId: string,
  ): Promise<string | null | undefined> {
    // Through the `app_rw` connection, not the owner client: `app.visible_people` is
    // SECURITY INVOKER, so the privileges and policies exercised are production's.
    const { rows } = await sql<{ user_id: string; display_name: string | null }>`
      select user_id, display_name from app.visible_people(${viewerId}, 4, 1500)
    `.execute(database);

    return rows.find((row) => row.user_id === subjectId)?.display_name;
  }

  describe('Scenario: A person changes their own display name', () => {
    it('stores the new name and echoes back what was stored', async () => {
      const { callerFor } = wireIdentity(database);
      const dusty = await seedUser('dusty_own', 'Dusty Rhodes');

      await expect(
        callerFor(dusty).identity.updateDisplayName({ displayName: 'Dust Storm' }),
      ).resolves.toEqual({ displayName: 'Dust Storm' });

      expect((await storedRow(dusty.userId)).display_name).toBe('Dust Storm');
    });

    it('stores the name trimmed, exactly as onboarding would have stored it', async () => {
      const { callerFor } = wireIdentity(database);
      const dusty = await seedUser('dusty_trim', 'Dusty Rhodes');

      await callerFor(dusty).identity.updateDisplayName({ displayName: '  Dust Storm  ' });

      expect((await storedRow(dusty.userId)).display_name).toBe('Dust Storm');
    });
  });

  describe('Scenario: A rename reaches only the caller’s own row (AC2)', () => {
    it('renames the actor on the context and leaves every other person alone', async () => {
      const { callerFor } = wireIdentity(database);
      const dusty = await seedUser('dusty_a', 'Dusty Rhodes');
      const moon = await seedUser('moon_b', 'Moon Light');

      await callerFor(dusty).identity.updateDisplayName({ displayName: 'Dust Storm' });

      expect((await storedRow(moon.userId)).display_name).toBe('Moon Light');
    });

    it('follows the caller, not the payload — one payload renames two different people', async () => {
      // The strongest available statement of "authorized server-side": the two calls
      // are byte-identical on the wire and land on different rows, because the only
      // thing distinguishing them is the actor the transport resolved. There is no
      // target field for a test to tamper with, which is the point (ADR-0002:180-181).
      const { callerFor } = wireIdentity(database);
      const dusty = await seedUser('dusty_same_a', 'Dusty Rhodes');
      const moon = await seedUser('moon_same_b', 'Moon Light');
      const payload = { displayName: 'Renamed By Themselves' };

      await callerFor(dusty).identity.updateDisplayName(payload);
      expect((await storedRow(dusty.userId)).display_name).toBe('Renamed By Themselves');
      expect((await storedRow(moon.userId)).display_name).toBe('Moon Light');

      await callerFor(moon).identity.updateDisplayName(payload);
      expect((await storedRow(moon.userId)).display_name).toBe('Renamed By Themselves');
    });

    it('refuses a payload that names a person, rather than dropping the field', async () => {
      const { callerFor } = wireIdentity(database);
      const dusty = await seedUser('dusty_idor', 'Dusty Rhodes');
      const moon = await seedUser('moon_idor', 'Moon Light');

      await expect(
        callerFor(dusty).identity.updateDisplayName({
          displayName: 'Not Yours To Change',
          userId: moon.userId,
        } as unknown as { displayName: string }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

      expect((await storedRow(moon.userId)).display_name).toBe('Moon Light');
      expect((await storedRow(dusty.userId)).display_name).toBe('Dusty Rhodes');
    });
  });

  describe('Scenario: Changing a display name does not break references by handle (AC4)', () => {
    it('leaves the handle exactly as it was, and the handle still finds the person', async () => {
      const { callerFor } = wireIdentity(database);
      const dusty = await seedUser('dusty_handle', 'Dusty Rhodes');
      const users = createPostgresUserRepository({ database });

      await callerFor(dusty).identity.updateDisplayName({ displayName: 'Dust Storm' });

      expect((await storedRow(dusty.userId)).handle).toBe('dusty_handle');
      // The stable identifier still resolves to the same row — which is what ADR-0008
      // rule 4's immutability buys, asserted as a property rather than assumed.
      const found = await users.findByHandle('dusty_handle');
      expect(found?.id).toBe(dusty.userId);
      expect(found?.displayName).toBe('Dust Storm');
    });

    it('refuses to change a handle offered alongside the name (AC3, ADR-0008 rule 4)', async () => {
      const { callerFor } = wireIdentity(database);
      const dusty = await seedUser('dusty_immutable', 'Dusty Rhodes');

      await expect(
        callerFor(dusty).identity.updateDisplayName({
          displayName: 'Dust Storm',
          handle: 'brand_new_handle',
        } as unknown as { displayName: string }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

      expect((await storedRow(dusty.userId)).handle).toBe('dusty_immutable');
    });
  });

  describe('Scenario: The edited name is what other people see (AC5)', () => {
    it('renders through app.visible_people on the next read, with no cache to invalidate', async () => {
      const { callerFor } = wireIdentity(database);
      const dusty = await seedUser('dusty_seen', 'Dusty Rhodes');
      const viewer = await seedUser('viewer_seen', 'The Viewer');
      await connect(dusty.userId, viewer.userId);

      expect(await nameSeenBy(viewer.userId, dusty.userId)).toBe('Dusty Rhodes');

      await callerFor(dusty).identity.updateDisplayName({ displayName: 'Dust Storm' });

      // No event was published and nothing was re-projected: the §6a projection reads
      // `app.users.display_name` at query time, so the viewer's very next read is
      // already the new name. That is why decision D15 records no outbox event —
      // there is no derived copy anywhere for one to go and correct.
      expect(await nameSeenBy(viewer.userId, dusty.userId)).toBe('Dust Storm');
    });

    it('discloses nothing new — a viewer the projection withholds a name from still gets none', async () => {
      // ⚠ The guard against this feature quietly widening §6a. Disclosure is granted
      // per *edge*, so a second-degree person is `topology_only` and their name never
      // leaves the database — before the rename and after it. A rename that made a
      // name appear here would mean the edit had found a second, ungated path to the
      // same column, which is exactly what ADR-0002 §6a forbids.
      const { callerFor } = wireIdentity(database);
      const dusty = await seedUser('dusty_far', 'Dusty Rhodes');
      const middle = await seedUser('middle_far', 'In Between');
      const far = await seedUser('viewer_far', 'Far Viewer');
      await connect(dusty.userId, middle.userId);
      await connect(middle.userId, far.userId);

      expect(await nameSeenBy(far.userId, dusty.userId)).toBeNull();

      await callerFor(dusty).identity.updateDisplayName({ displayName: 'Dust Storm' });

      // Still on the far viewer's graph — this is topology, not absence — and still
      // with no name on the row.
      expect(await nameSeenBy(far.userId, dusty.userId)).toBeNull();
    });
  });

  describe('Scenario: A refused name leaves the stored one alone', () => {
    it.each([
      ['whitespace_only', '   '],
      ['empty_string', ''],
      ['over_the_bound', 'n'.repeat(DISPLAY_NAME_MAX_LENGTH + 1)],
    ])('refuses %s and does not touch app.users', async (label, displayName) => {
      const { callerFor } = wireIdentity(database);
      const dusty = await seedUser(`dusty_${label}`, 'Dusty Rhodes');

      await expect(
        callerFor(dusty).identity.updateDisplayName({ displayName }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

      expect((await storedRow(dusty.userId)).display_name).toBe('Dusty Rhodes');
    });

    it('accepts a name of exactly the maximum length', async () => {
      const { callerFor } = wireIdentity(database);
      const dusty = await seedUser('dusty_atbound', 'Dusty Rhodes');
      const longest = 'n'.repeat(DISPLAY_NAME_MAX_LENGTH);

      await expect(
        callerFor(dusty).identity.updateDisplayName({ displayName: longest }),
      ).resolves.toEqual({ displayName: longest });
    });
  });

  it('does not bump the row’s version — a rename is not a contended edit (ADR-0005)', async () => {
    // ADR-0005's matrix has no row for a rename, and `setVisibleToDistance` set the
    // precedent beside this one: a single-writer column whose only writer is its owner
    // is last-write-wins, because a conflict here would read as "your own name change
    // was rejected because your other device also changed it".
    const { callerFor } = wireIdentity(database);
    const dusty = await seedUser('dusty_version', 'Dusty Rhodes');
    const before = (await storedRow(dusty.userId)).version;

    await callerFor(dusty).identity.updateDisplayName({ displayName: 'Dust Storm' });

    expect((await storedRow(dusty.userId)).version).toBe(before);
  });
});

/** Mirrors `packages/database/src/database-schema.integration.test.ts`'s helper. */
function asRole(connectionString: string, username: string, password: string): string {
  const url = new URL(connectionString);
  url.username = username;
  url.password = password;
  return url.toString();
}

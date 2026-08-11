import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  REPOSITORY_MIGRATIONS_DIRECTORY,
  startPostgresTestDatabase,
  type PostgresTestDatabase,
} from '@playa-post/testing';

/**
 * The migration-shape suite for `app.notify_me_queries`, mirroring
 * `modules/bulletins/tests/integration/bulletins-schema-migration.integration.test.ts`'s
 * discipline: catalog facts, never a read of the SQL file.
 *
 * m2-lane-briefs.md §L3b-notify pinned two things about this table beyond the standard
 * ADR-0002 §4 backstop: the primary key, and that it **stores the source text plus the
 * validated AST with an `ast_version`** (ADR-0007:70-72). The second is unchanged. The
 * first was `owner_id` — D1's "exactly one Notify Me query per user" as a database
 * constraint — and **issue #172 reopened D1**: the key is now `id`, with a
 * `UNIQUE NULLS NOT DISTINCT (owner_id, source_view_id)` carrying the invariant that
 * replaced it (decision D16).
 *
 * The second `describe` in this file is the one that proves nobody's notifications were
 * lost on the way (#172 AC3), and it is the only suite in the repository that applies the
 * migrations in two halves to do it.
 */
describe('migration — app.notify_me_queries', () => {
  let database: PostgresTestDatabase;

  beforeAll(async () => {
    database = await startPostgresTestDatabase();
  }, 300_000);

  // The constraint assertions below write rows to find out what the database refuses, so
  // this suite stopped being catalog-only when #172 gave it a uniqueness rule to prove.
  afterEach(async () => {
    await database.truncateAllTables();
  });

  afterAll(async () => {
    await database?.stop();
  });

  it('is created by the migration', async () => {
    const { rows } = await database.client.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'app' and table_type = 'BASE TABLE' and table_name = 'notify_me_queries'`,
    );
    expect(rows).toHaveLength(1);
  });

  it('has RLS enabled, FORCEd, and owned by app_migrator', async () => {
    const { rows } = await database.client.query<{
      rls_enabled: boolean;
      rls_forced: boolean;
      owner: string;
    }>(
      `select c.relrowsecurity as rls_enabled,
              c.relforcerowsecurity as rls_forced,
              pg_catalog.pg_get_userbyid(c.relowner) as owner
         from pg_catalog.pg_class c
         join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'app' and c.relname = 'notify_me_queries'`,
    );

    expect(rows, 'app.notify_me_queries must exist to assert its RLS shape').toEqual([
      { rls_enabled: true, rls_forced: true, owner: 'app_migrator' },
    ]);
  });

  it('grants app_rw all DML and no privilege to anon/authenticated/public', async () => {
    const { rows: grantRows } = await database.client.query<{ has_privilege: boolean }>(
      `select pg_catalog.has_table_privilege('app_rw', 'app.notify_me_queries', 'SELECT,INSERT,UPDATE,DELETE') as has_privilege`,
    );
    expect(grantRows[0]?.has_privilege).toBe(true);

    for (const grantee of ['anon', 'authenticated', 'public']) {
      const { rows } = await database.client.query<{ has_privilege: boolean }>(
        `select pg_catalog.has_table_privilege($1, 'app.notify_me_queries',
            'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as has_privilege`,
        [grantee],
      );
      expect(rows[0]?.has_privilege, `${grantee} must hold no privilege on app.notify_me_queries`).toBe(
        false,
      );
    }
  });

  describe('the key that replaced D1 (decision D16, issue #172)', () => {
    it('keys on a surrogate id, so one owner may hold several queries', async () => {
      expect(
        await hasPrimaryKeyConstraint(database, 'app.notify_me_queries', ['id']),
        'the primary key must be `id` — `owner_id` was D1\'s "one query per user" and D16 reopened it',
      ).toBe(true);

      expect(
        await hasPrimaryKeyConstraint(database, 'app.notify_me_queries', ['owner_id']),
        'the owner_id primary key must be gone, or nothing above it can enable a second bell',
      ).toBe(false);
    });

    it('allows two rows for one owner when they name different views', async () => {
      const owner = await seedOwner(database, 'shape_two_bells');
      const first = await seedSavedView(database, owner, 'Rides');
      const second = await seedSavedView(database, owner, 'Events');

      await insertNotifyMeQuery(database, owner, first);
      await insertNotifyMeQuery(database, owner, second);

      const { rows } = await database.client.query<{ count: string }>(
        `select count(*)::text as count from app.notify_me_queries where owner_id = $1`,
        [owner],
      );
      expect(rows[0]?.count).toBe('2');
    });

    it('refuses a second query for the same (owner, view), so a double tap converges', async () => {
      const owner = await seedOwner(database, 'shape_same_view_twice');
      const view = await seedSavedView(database, owner, 'Rides');

      await insertNotifyMeQuery(database, owner, view);

      await expect(insertNotifyMeQuery(database, owner, view)).rejects.toThrow(
        /notify_me_queries_owner_id_source_view_id_key/,
      );
    });

    it('refuses a second untied query, because NULL is a key value here and not an exemption', async () => {
      // ⚠ The one assertion in this file that `NULLS NOT DISTINCT` is what shipped. Under
      // PostgreSQL's default a unique constraint treats every NULL as distinct, so this
      // insert would succeed and a person could accumulate untied queries — none of which
      // `views.notifyMe.update` could ever name again, because it addresses "your row with
      // no view" and there would be several.
      const owner = await seedOwner(database, 'shape_two_untied');

      await insertNotifyMeQuery(database, owner, null);

      await expect(insertNotifyMeQuery(database, owner, null)).rejects.toThrow(
        /notify_me_queries_owner_id_source_view_id_key/,
      );
    });

    it("still refuses a designation pointing at another owner's view", async () => {
      // The composite foreign key is untouched by #172 and this is the assertion that says
      // so: the key swap moved what makes a row unique, not what makes it legal.
      const ownerA = await seedOwner(database, 'shape_fkey_a');
      const ownerB = await seedOwner(database, 'shape_fkey_b');
      const viewA = await seedSavedView(database, ownerA, 'A rides');

      await expect(insertNotifyMeQuery(database, ownerB, viewA)).rejects.toThrow(
        /notify_me_queries_source_view_fkey/,
      );
    });
  });

  describe('source text + validated AST (ADR-0007:70-72)', () => {
    it('has a not-null source_text column', async () => {
      const { rows } = await database.client.query<{ is_nullable: string }>(
        `select is_nullable from information_schema.columns
          where table_schema = 'app' and table_name = 'notify_me_queries' and column_name = 'source_text'`,
      );
      expect(rows[0], 'app.notify_me_queries.source_text must exist').toBeDefined();
      expect(rows[0]?.is_nullable).toBe('NO');
    });

    it('has a not-null jsonb ast column', async () => {
      const { rows } = await database.client.query<{ is_nullable: string; data_type: string }>(
        `select is_nullable, data_type from information_schema.columns
          where table_schema = 'app' and table_name = 'notify_me_queries' and column_name = 'ast'`,
      );
      expect(rows[0], 'app.notify_me_queries.ast must exist').toBeDefined();
      expect(rows[0]?.is_nullable).toBe('NO');
      expect(rows[0]?.data_type).toBe('jsonb');
    });

    it('has a not-null integer ast_version column, separate from ast itself', async () => {
      const { rows } = await database.client.query<{ is_nullable: string; data_type: string }>(
        `select is_nullable, data_type from information_schema.columns
          where table_schema = 'app' and table_name = 'notify_me_queries' and column_name = 'ast_version'`,
      );
      expect(rows[0], 'app.notify_me_queries.ast_version must exist').toBeDefined();
      expect(rows[0]?.is_nullable).toBe('NO');
      expect(rows[0]?.data_type).toMatch(/int/i);
    });
  });

  it('has a not-null integer version column (ADR-0005 optimistic concurrency)', async () => {
    const { rows } = await database.client.query<{ is_nullable: string; data_type: string }>(
      `select is_nullable, data_type from information_schema.columns
        where table_schema = 'app' and table_name = 'notify_me_queries' and column_name = 'version'`,
    );
    expect(rows[0], 'app.notify_me_queries.version must exist').toBeDefined();
    expect(rows[0]?.is_nullable).toBe('NO');
    expect(rows[0]?.data_type).toMatch(/int/i);
  });
});

/**
 * The migration this issue adds, by name.
 *
 * ⚠ Named rather than "the last file in the directory": the replay below has to split the
 * directory at *this* migration, and a later unrelated one landing after it must not
 * silently move the cut.
 */
const NOTIFY_ME_PER_VIEW_MIGRATION = '20260812120000_notify_me_queries_per_view.sql';

/**
 * Scenario: somebody who had Notify Me switched on still has it switched on (#172 AC3).
 *
 * ⚠ **The only suite here that applies the migrations in two halves, and it has to.**
 * Every other integration test starts a container with the whole of `supabase/migrations`
 * already applied, which means there is no such thing as a row that predates one of them —
 * and "existing users migrate cleanly" is a claim about exactly those rows. Asserting the
 * post-migration shape instead would prove the new schema is reachable, not that anybody's
 * lit bell survived the trip.
 *
 * So: apply everything up to but excluding #172's migration, write the row a person would
 * have had under D1 — one query per owner, keyed on `owner_id`, pointing at the view whose
 * bell they lit — then apply #172's migration on top and look at what is left.
 *
 * It uses raw SQL throughout on purpose. The repositories in this module speak the *new*
 * schema, so they cannot write the old row this test exists to age, and a fixture that
 * could would not be the fixture the question is about.
 */
describe('Scenario: an existing Notify Me user survives the key swap (#172 AC3, D16)', () => {
  let database: PostgresTestDatabase;
  let ownerId: string;
  let viewId: string;

  beforeAll(async () => {
    database = await startPostgresTestDatabase({ migrationsDirectory: null });

    const filenames = (await readdir(REPOSITORY_MIGRATIONS_DIRECTORY))
      .filter((entry) => entry.endsWith('.sql'))
      .sort();
    const cut = filenames.indexOf(NOTIFY_ME_PER_VIEW_MIGRATION);
    if (cut === -1) {
      throw new Error(
        `${NOTIFY_ME_PER_VIEW_MIGRATION} is not in ${REPOSITORY_MIGRATIONS_DIRECTORY} — rename the constant with the file`,
      );
    }

    for (const filename of filenames.slice(0, cut)) {
      await database.client.query(
        await readFile(join(REPOSITORY_MIGRATIONS_DIRECTORY, filename), 'utf8'),
      );
    }

    // The world as D1 left it: one person, one saved view, one Notify Me query keyed on
    // `owner_id` alone and designated from that view. No `id` column exists yet to supply.
    const { rows: userRows } = await database.client.query<{ id: string }>(
      `insert into app.users (auth_user_id, handle, display_name, created_at)
       values ($1, 'dusty_pre_172', 'dusty_pre_172', now()) returning id`,
      [randomUUID()],
    );
    ownerId = userRows[0]?.id ?? '';

    const { rows: viewRows } = await database.client.query<{ id: string }>(
      `insert into app.saved_views
         (owner_id, name, source_text, ast, ast_version, created_at, updated_at)
       values ($1, 'Rides to BRC', 'type:offer truck', $2::jsonb, 1, now(), now())
       returning id`,
      [ownerId, JSON.stringify({ types: ['offer'], text: ['truck'] })],
    );
    viewId = viewRows[0]?.id ?? '';

    await database.client.query(
      `insert into app.notify_me_queries
         (owner_id, source_text, ast, ast_version, version, updated_at, source_view_id)
       values ($1, 'type:offer truck', $2::jsonb, 1, 4, now(), $3)`,
      [ownerId, JSON.stringify({ types: ['offer'], text: ['truck'] }), viewId],
    );

    await database.client.query(
      await readFile(join(REPOSITORY_MIGRATIONS_DIRECTORY, NOTIFY_ME_PER_VIEW_MIGRATION), 'utf8'),
    );
  }, 300_000);

  afterAll(async () => {
    await database?.stop();
  });

  it('keeps the row, its designation, its version and its query, and gives it an id', async () => {
    const { rows } = await database.client.query<{
      id: string | null;
      owner_id: string;
      source_text: string;
      source_view_id: string | null;
      version: number;
      ast_version: number;
    }>(
      // Scoped to the seeded designation rather than reading the whole table, so the
      // sibling test below — which lights a second bell for this same person — cannot
      // change what this one sees whatever order they run in.
      `select id, owner_id, source_text, source_view_id, version, ast_version
         from app.notify_me_queries
        where owner_id = $1 and source_view_id = $2`,
      [ownerId, viewId],
    );

    expect(rows, 'the migration must not drop, re-create or re-insert this row').toHaveLength(1);
    expect(rows[0]).toMatchObject({
      owner_id: ownerId,
      // The bell is still lit, on the same card. This single field is what AC3 is about:
      // everything else could survive and a person would still find their notifications
      // switched off.
      source_view_id: viewId,
      source_text: 'type:offer truck',
      // Carried across rather than reset. A version that restarted at 1 would make every
      // client holding an `expectedVersion` conflict against state nobody changed.
      version: 4,
      ast_version: 1,
    });
    // Backfilled by the column default, per row, with no UPDATE of ours.
    expect(rows[0]?.id).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('lets that person light a second bell straight away, with no further migration', async () => {
    // The point of the whole change, asserted on a *migrated* row rather than a fresh one:
    // an existing user is not left in some grandfathered single-query state.
    const { rows: viewRows } = await database.client.query<{ id: string }>(
      `insert into app.saved_views
         (owner_id, name, source_text, ast, ast_version, created_at, updated_at)
       values ($1, 'Kitchen crew', 'type:request', $2::jsonb, 1, now(), now())
       returning id`,
      [ownerId, JSON.stringify({ types: ['request'], text: [] })],
    );
    const second = viewRows[0]?.id ?? '';

    await database.client.query(
      `insert into app.notify_me_queries
         (owner_id, source_text, ast, ast_version, updated_at, source_view_id)
       values ($1, 'type:request', $2::jsonb, 1, now(), $3)`,
      [ownerId, JSON.stringify({ types: ['request'], text: [] }), second],
    );

    const { rows } = await database.client.query<{ source_view_id: string | null }>(
      `select source_view_id from app.notify_me_queries where owner_id = $1 order by source_view_id`,
      [ownerId],
    );
    expect(rows.map((row) => row.source_view_id).sort()).toEqual([viewId, second].sort());
  });
});

/** One onboarded person, for the constraint assertions. */
async function seedOwner(database: PostgresTestDatabase, handle: string): Promise<string> {
  const { rows } = await database.client.query<{ id: string }>(
    `insert into app.users (auth_user_id, handle, display_name, created_at)
     values ($1, $2, $3, now()) returning id`,
    [randomUUID(), handle, handle],
  );
  const id = rows[0]?.id;
  if (id === undefined) {
    throw new Error('seedOwner: insert returned no row');
  }
  return id;
}

/** One saved view for that person, so a designation has something legal to point at. */
async function seedSavedView(
  database: PostgresTestDatabase,
  ownerId: string,
  name: string,
): Promise<string> {
  const { rows } = await database.client.query<{ id: string }>(
    `insert into app.saved_views (owner_id, name, source_text, ast, ast_version, created_at, updated_at)
     values ($1, $2, 'type:offer', $3::jsonb, 1, now(), now()) returning id`,
    [ownerId, name, JSON.stringify({ types: ['offer'], text: [] })],
  );
  const id = rows[0]?.id;
  if (id === undefined) {
    throw new Error('seedSavedView: insert returned no row');
  }
  return id;
}

/**
 * One Notify Me row, written in raw SQL.
 *
 * Deliberately not through the repository: these tests ask what the *database* refuses,
 * and a fixture that went through the application would be asking what the application
 * refuses — a different question, answered in a different file.
 */
async function insertNotifyMeQuery(
  database: PostgresTestDatabase,
  ownerId: string,
  sourceViewId: string | null,
): Promise<void> {
  await database.client.query(
    `insert into app.notify_me_queries
       (owner_id, source_text, ast, ast_version, updated_at, source_view_id)
     values ($1, 'type:offer', $2::jsonb, 1, now(), $3)`,
    [ownerId, JSON.stringify({ types: ['offer'], text: [] }), sourceViewId],
  );
}

/**
 * Copied from `bulletins-schema-migration.integration.test.ts`'s local copy of the
 * same helper (itself copied from `connections-schema-migration.integration.test.ts`).
 * Kept as a third local copy per those files' own note that the coder is free to
 * promote a shared version in the same PR that removes the duplication — not this
 * suite's job to invent that shared home unasked.
 */
async function hasPrimaryKeyConstraint(
  database: PostgresTestDatabase,
  qualifiedTable: string,
  columns: readonly string[],
): Promise<boolean> {
  const [schema, table] = qualifiedTable.split('.');
  const { rows } = await database.client.query<{ columns: string[] }>(
    `select array_agg(kcu.column_name::text order by kcu.ordinal_position) as columns
       from information_schema.table_constraints tc
       join information_schema.key_column_usage kcu
         on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
      where tc.constraint_type = 'PRIMARY KEY'
        and tc.table_schema = $1
        and tc.table_name = $2
      group by tc.constraint_name`,
    [schema, table],
  );

  const expected = [...columns].sort();

  return rows.some((row) => {
    if (!Array.isArray(row.columns)) {
      throw new TypeError(`expected an array of column names, received ${typeof row.columns}`);
    }
    const actual = [...row.columns].sort();
    return actual.length === expected.length && actual.every((c, i) => c === expected[i]);
  });
}

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
 * ADR-0002 §4 backstop: the key, and that it **stores the source text plus the
 * validated AST with an `ast_version`** (ADR-0007:70-72). The second is unchanged. The
 * first has moved twice: `owner_id` was D1's "exactly one Notify Me query per user" as
 * a primary key, #172/D16 reopened it into a per-view set, and **#208 removed Saved
 * Views** (ADR-0019), restoring one-per-owner as `unique (owner_id)` while keeping
 * `id` as the primary key — the outbox routes events by that aggregate id, and swapping
 * it back would change what existing `NotifyMeQueryChanged` events mean.
 *
 * The second `describe` in this file is the one that proves an untied Notify Me query
 * survives #208's migration, and it is the only suite in the repository that applies the
 * migrations in two halves to do it.
 */
describe('migration — app.notify_me_queries', () => {
  let database: PostgresTestDatabase;

  beforeAll(async () => {
    database = await startPostgresTestDatabase();
  }, 300_000);

  // The constraint assertions below write rows to find out what the database refuses,
  // so this suite is not catalog-only.
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

  describe('the one-query-per-owner key (#208, ADR-0019)', () => {
    it('keeps the surrogate id as the primary key, for outbox aggregate routing', async () => {
      expect(
        await hasPrimaryKeyConstraint(database, 'app.notify_me_queries', ['id']),
        'the primary key must stay `id` — the outbox routes NotifyMeQueryChanged by it',
      ).toBe(true);

      expect(
        await hasPrimaryKeyConstraint(database, 'app.notify_me_queries', ['owner_id']),
        '`owner_id` carries a unique constraint, never the primary key (#208)',
      ).toBe(false);
    });

    it('has no source_view_id column — the designation went with app.saved_views', async () => {
      const { rows } = await database.client.query<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_schema = 'app' and table_name = 'notify_me_queries'
            and column_name = 'source_view_id'`,
      );
      expect(rows).toHaveLength(0);
    });

    it('refuses a second query for the same owner, so a person holds exactly one', async () => {
      const owner = await seedOwner(database, 'shape_one_per_owner');

      await insertNotifyMeQuery(database, owner);

      await expect(insertNotifyMeQuery(database, owner)).rejects.toThrow(
        /notify_me_queries_owner_id_key/,
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
 * The migration #208 adds, by name.
 *
 * ⚠ Named rather than "the last file in the directory": the replay below has to split the
 * directory at *this* migration, and a later unrelated one landing after it must not
 * silently move the cut.
 */
const REMOVE_SAVED_VIEWS_MIGRATION = '20260813214946_remove_saved_views.sql';

/**
 * Scenario: somebody whose Notify Me query was never tied to a view keeps it through the
 * Saved Views removal, and somebody whose query WAS a per-view bell loses that row —
 * both are what #208 decided, and only a two-half replay can prove either.
 *
 * ⚠ **The only suite here that applies the migrations in two halves, and it has to.**
 * Every other integration test starts a container with the whole of `supabase/migrations`
 * already applied, which means there is no such thing as a row that predates one of them —
 * and "an existing user migrates cleanly" is a claim about exactly those rows.
 *
 * So: apply everything up to but excluding #208's migration, write the rows the D16-era
 * schema held — an untied query and a designated one — then apply #208's migration on top
 * and look at what is left.
 *
 * It uses raw SQL throughout on purpose. The repositories in this module speak the *new*
 * schema, so they cannot write the old rows this test exists to age.
 */
describe('Scenario: an untied Notify Me query survives the Saved Views removal (#208, ADR-0019)', () => {
  let database: PostgresTestDatabase;
  let untiedOwnerId: string;
  let designatedOwnerId: string;

  beforeAll(async () => {
    database = await startPostgresTestDatabase({ migrationsDirectory: null });

    const filenames = (await readdir(REPOSITORY_MIGRATIONS_DIRECTORY))
      .filter((entry) => entry.endsWith('.sql'))
      .sort();
    const cut = filenames.indexOf(REMOVE_SAVED_VIEWS_MIGRATION);
    if (cut === -1) {
      throw new Error(
        `${REMOVE_SAVED_VIEWS_MIGRATION} is not in ${REPOSITORY_MIGRATIONS_DIRECTORY} — rename the constant with the file`,
      );
    }

    for (const filename of filenames.slice(0, cut)) {
      await database.client.query(
        await readFile(join(REPOSITORY_MIGRATIONS_DIRECTORY, filename), 'utf8'),
      );
    }

    // The world as D16 left it: one person with an untied query (`source_view_id` NULL —
    // the row `views.notifyMe.update` wrote), and one person whose only query was a
    // per-view bell on a saved view.
    untiedOwnerId = await seedOwner(database, 'dusty_untied_pre_208');
    designatedOwnerId = await seedOwner(database, 'dusty_designated_pre_208');

    await database.client.query(
      `insert into app.notify_me_queries
         (owner_id, source_text, ast, ast_version, version, updated_at, source_view_id)
       values ($1, 'type:offer truck', $2::jsonb, 1, 4, now(), null)`,
      [untiedOwnerId, JSON.stringify({ types: ['offer'], text: ['truck'] })],
    );

    const { rows: viewRows } = await database.client.query<{ id: string }>(
      `insert into app.saved_views
         (owner_id, name, source_text, ast, ast_version, created_at, updated_at)
       values ($1, 'Rides to BRC', 'type:offer truck', $2::jsonb, 1, now(), now())
       returning id`,
      [designatedOwnerId, JSON.stringify({ types: ['offer'], text: ['truck'] })],
    );
    const viewId = viewRows[0]?.id;
    if (viewId === undefined) {
      throw new Error('pre-#208 seed: saved-view insert returned no row');
    }
    await database.client.query(
      `insert into app.notify_me_queries
         (owner_id, source_text, ast, ast_version, version, updated_at, source_view_id)
       values ($1, 'type:offer truck', $2::jsonb, 1, 1, now(), $3)`,
      [designatedOwnerId, JSON.stringify({ types: ['offer'], text: ['truck'] }), viewId],
    );

    await database.client.query(
      await readFile(join(REPOSITORY_MIGRATIONS_DIRECTORY, REMOVE_SAVED_VIEWS_MIGRATION), 'utf8'),
    );
  }, 300_000);

  afterAll(async () => {
    await database?.stop();
  });

  it('keeps the untied row — its query, its version, its updated_at discipline — intact', async () => {
    const { rows } = await database.client.query<{
      owner_id: string;
      source_text: string;
      version: number;
      ast_version: number;
    }>(
      `select owner_id, source_text, version, ast_version
         from app.notify_me_queries
        where owner_id = $1`,
      [untiedOwnerId],
    );

    expect(rows, 'the migration must not drop, re-create or re-insert this row').toHaveLength(1);
    expect(rows[0]).toMatchObject({
      owner_id: untiedOwnerId,
      source_text: 'type:offer truck',
      // Carried across rather than reset. A version that restarted at 1 would make every
      // client holding an `expectedVersion` conflict against state nobody changed.
      version: 4,
      ast_version: 1,
    });
  });

  it("deletes the designated row with the view it pointed at — a bell, not somebody's standing query", async () => {
    const { rows } = await database.client.query<{ count: string }>(
      `select count(*)::text as count from app.notify_me_queries where owner_id = $1`,
      [designatedOwnerId],
    );
    expect(rows[0]?.count).toBe('0');
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
): Promise<void> {
  await database.client.query(
    `insert into app.notify_me_queries
       (owner_id, source_text, ast, ast_version, updated_at)
     values ($1, 'type:offer', $2::jsonb, 1, now())`,
    [ownerId, JSON.stringify({ types: ['offer'], text: [] })],
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

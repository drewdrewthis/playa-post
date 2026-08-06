import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startPostgresTestDatabase, type PostgresTestDatabase } from '@playa-post/testing';

/**
 * L2's migration-shape suite, mirroring
 * `modules/identity/tests/integration/app-users-migration.integration.test.ts`'s
 * discipline for L1's `app.users`: catalog facts, not a read of the SQL file.
 *
 * m2-lane-briefs.md §L2 assigns this lane five tables in one migration PR (C1a):
 * `app.invitations`, `app.connections`, `app.connection_trust`, `app.outbox_events`,
 * `app.consumer_receipts`. **`app.outbox_events` and `app.consumer_receipts` are L2's
 * flatly** (ratified decision (a)) because M2-AC19 needs to demonstrate zero
 * `outbox_events` rows for `connection.accept` and `trust.set`.
 *
 * `app.outbox_events` and `app.consumer_receipts` are asserted **verbatim** against
 * ADR-0006's schema block (docs/adr/ADR-0006-outbox-and-queue-delivery.md:20-34,72-73)
 * — those two are contract, not a lane choice. `app.invitations` and `app.connections`
 * are asserted at the level the lane brief actually specifies (existence, RLS
 * backstop, grants) — their exact column shapes are not pinned by any ADR the coder is
 * bound to, so pinning arbitrary column names here would fail the coder for a choice
 * this suite has no standing to make. `app.connection_trust` gets its exact keying and
 * nullability pinned, because that shape **is** ratified (m2-lane-briefs.md:472-494,
 * ADR-0004:70-71, and this lane's own ratified LEFT JOIN-absence decision, see
 * `directional-trust.integration.test.ts`'s header comment).
 */
describe('L2 migration — app.invitations, app.connections, app.connection_trust, app.outbox_events, app.consumer_receipts', () => {
  let database: PostgresTestDatabase;
  let appTables: readonly string[];

  beforeAll(async () => {
    database = await startPostgresTestDatabase();
    const { rows } = await database.client.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'app' and table_type = 'BASE TABLE'`,
    );
    appTables = rows.map((row) => row.table_name);
  }, 300_000);

  afterAll(async () => {
    await database?.stop();
  });

  describe.each([
    ['app.invitations', 'invitations'],
    ['app.connections', 'connections'],
    ['app.connection_trust', 'connection_trust'],
    ['app.outbox_events', 'outbox_events'],
    ['app.consumer_receipts', 'consumer_receipts'],
  ])('%s exists and carries the RLS backstop + grants', (qualifiedName, tableName) => {
    it('is created by the migration', () => {
      expect(appTables).toContain(tableName);
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
          where n.nspname = 'app' and c.relname = $1`,
        [tableName],
      );

      expect(rows, `${qualifiedName} must exist to assert its RLS shape`).toEqual([
        { rls_enabled: true, rls_forced: true, owner: 'app_migrator' },
      ]);
    });

    it('grants app_rw all DML and no privilege to anon/authenticated/public', async () => {
      const { rows: grantRows } = await database.client.query<{ has_privilege: boolean }>(
        `select pg_catalog.has_table_privilege('app_rw', $1, 'SELECT,INSERT,UPDATE,DELETE') as has_privilege`,
        [qualifiedName],
      );
      expect(grantRows[0]?.has_privilege).toBe(true);

      for (const grantee of ['anon', 'authenticated', 'public']) {
        const { rows } = await database.client.query<{ has_privilege: boolean }>(
          `select pg_catalog.has_table_privilege($1, $2,
              'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as has_privilege`,
          [grantee, qualifiedName],
        );
        expect(rows[0]?.has_privilege, `${grantee} must hold no privilege on ${qualifiedName}`).toBe(
          false,
        );
      }
    });
  });

  describe('app.connection_trust — the ratified shape (owner_id, subject_id) key, unset = absent row', () => {
    it('is keyed (owner_id, subject_id), not by a surrogate connection FK alone', async () => {
      const isKeyed = await hasKeyConstraint(database, 'app.connection_trust', [
        'owner_id',
        'subject_id',
      ]);
      expect(isKeyed).toBe(true);
    });

    it('has a trust column that is nullable with no default — NULL is a first-class value, never defaulted to 0', async () => {
      const { rows } = await database.client.query<{
        is_nullable: string;
        column_default: string | null;
      }>(
        `select is_nullable, column_default
           from information_schema.columns
          where table_schema = 'app' and table_name = 'connection_trust' and column_name = 'trust'`,
      );

      expect(rows[0]?.is_nullable).toBe('YES');
      expect(rows[0]?.column_default).toBeNull();
    });
  });

  describe('app.outbox_events — verbatim ADR-0006:20-34', () => {
    it('has exactly the ADR-0006 columns', async () => {
      const { rows } = await database.client.query<{ column_name: string; is_nullable: string }>(
        `select column_name, is_nullable
           from information_schema.columns
          where table_schema = 'app' and table_name = 'outbox_events'
          order by ordinal_position`,
      );
      const byName = Object.fromEntries(rows.map((row) => [row.column_name, row]));

      expect(Object.keys(byName).sort()).toEqual(
        [
          'event_id',
          'event_type',
          'event_version',
          'occurred_at',
          'actor_id',
          'aggregate_id',
          'payload',
          'status',
          'attempts',
          'available_at',
          'claimed_at',
          'claimed_by',
          'last_error',
        ].sort(),
      );

      expect(byName['event_id']?.is_nullable).toBe('NO');
      expect(byName['event_type']?.is_nullable).toBe('NO');
      expect(byName['occurred_at']?.is_nullable).toBe('NO');
      expect(byName['aggregate_id']?.is_nullable).toBe('NO');
      expect(byName['payload']?.is_nullable).toBe('NO');
      expect(byName['status']?.is_nullable).toBe('NO');
      expect(byName['actor_id']?.is_nullable).toBe('YES');
    });

    it('has a partial index on available_at for pending/claimed rows (drainer claim query)', async () => {
      const { rows } = await database.client.query<{ indexdef: string }>(
        `select indexdef from pg_catalog.pg_indexes
          where schemaname = 'app' and tablename = 'outbox_events'`,
      );
      expect(rows.some((row) => /available_at/i.test(row.indexdef))).toBe(true);
    });
  });

  describe('app.consumer_receipts — verbatim ADR-0006:72-73', () => {
    it('has exactly the ADR-0006 columns, primary keyed (consumer_name, event_id)', async () => {
      const { rows } = await database.client.query<{ column_name: string }>(
        `select column_name
           from information_schema.columns
          where table_schema = 'app' and table_name = 'consumer_receipts'
          order by ordinal_position`,
      );
      expect(rows.map((row) => row.column_name).sort()).toEqual(
        ['consumer_name', 'event_id', 'processed_at'].sort(),
      );

      const isKeyed = await hasKeyConstraint(database, 'app.consumer_receipts', [
        'consumer_name',
        'event_id',
      ]);
      expect(isKeyed).toBe(true);
    });
  });
});

/**
 * Extracted from `modules/identity/tests/integration/app-users-migration.integration.test.ts`'s
 * `hasUniqueConstraint` per the lane brief's instruction to reuse rather than
 * rewrite. Kept as a local copy rather than an import — that test lives under
 * `modules/identity/`, and this lane must not touch identity internals; the coder is
 * free to promote this into a shared test-support module in the same PR that removes
 * the duplication (see this lane's "notes for coder").
 *
 * ⚠ **Widened from the L1 original to accept a PRIMARY KEY as well as a UNIQUE
 * constraint, and renamed accordingly.** The original only ever ran against
 * `app.users`, whose keys are genuine `UNIQUE` constraints. Both callers here ask
 * about a composite key that ADR-0006:72-73 spells `primary key (consumer_name,
 * event_id)` — a shape `constraint_type = 'UNIQUE'` cannot see, which is why the
 * describe block above says "primary keyed" while the original helper would have
 * failed it. A primary key is strictly stronger (unique **and** not null), so
 * accepting one narrows nothing; the alternative was writing a redundant second index
 * beside the key, or storing these tables without a primary key at all — and a table
 * with no primary key has no replica identity, which is an operational problem to
 * carry for a test helper's benefit.
 *
 * ⚠ `::text` is load-bearing: `key_column_usage.column_name` is an
 * `information_schema.sql_identifier` domain, and without the cast `array_agg` yields
 * a type `node-postgres` cannot parse, so every table would silently report "no
 * key constraint" (measured in the L1 test this is copied from).
 */
async function hasKeyConstraint(
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
      where tc.constraint_type in ('UNIQUE', 'PRIMARY KEY')
        and tc.table_schema = $1
        and tc.table_name = $2
      group by tc.constraint_name`,
    [schema, table],
  );

  const expected = [...columns].sort();

  return rows.some((row) => {
    if (!Array.isArray(row.columns)) {
      throw new TypeError(
        `expected an array of column names from array_agg, received ${typeof row.columns}`,
      );
    }
    const actual = [...row.columns].sort();
    return actual.length === expected.length && actual.every((c, i) => c === expected[i]);
  });
}

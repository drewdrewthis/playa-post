import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startPostgresTestDatabase, type PostgresTestDatabase } from '@playa-post/testing';

/**
 * The migration shape for issue #206's two tables: catalog facts, not a read of the SQL file.
 *
 * The `describe.each` block is the same one `connections-schema-migration.integration.test.ts`
 * runs over L2's five tables — existence, the ADR-0002 §4 backstop, and the grants B3 reads
 * — because those three are what makes a table safe rather than merely present. What is
 * added below it is the shape ADR-0018 actually ratifies, and only that: the one-link-per-
 * owner key, the unique slug, the partial open-per-pair index, and the two CHECKs that keep
 * `decided_at` honest.
 */
describe('#206 migration — app.personal_links, app.connection_requests', () => {
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
    ['app.personal_links', 'personal_links'],
    ['app.connection_requests', 'connection_requests'],
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

  describe('app.personal_links — one link per owner, and no retired slug anywhere', () => {
    it('is primary keyed on owner_id, so a second row for one person is impossible', async () => {
      // ⚠ The key *is* the "one active link" rule (ADR-0018 D3). A surrogate id with a
      // uniqueness constraint beside it would leave "which row is current" to a reader.
      const { rows } = await database.client.query<{ columns: string[] }>(
        `select array_agg(kcu.column_name::text order by kcu.ordinal_position) as columns
           from information_schema.table_constraints tc
           join information_schema.key_column_usage kcu
             on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
          where tc.constraint_type = 'PRIMARY KEY'
            and tc.table_schema = 'app' and tc.table_name = 'personal_links'
          group by tc.constraint_name`,
      );

      expect(rows[0]?.columns).toEqual(['owner_id']);
    });

    it('holds a unique slug, because the slug is the lookup key', async () => {
      const { rows } = await database.client.query<{ indexdef: string }>(
        `select indexdef from pg_catalog.pg_indexes
          where schemaname = 'app' and tablename = 'personal_links'`,
      );

      expect(rows.some((row) => /unique/i.test(row.indexdef) && /\(slug\)/.test(row.indexdef))).toBe(
        true,
      );
    });

    /*
     * ⚠ **The anti-oracle property, asserted as an absence of storage.** Rotation overwrites
     * the slug, so there must be no column in which a retired one could survive — a
     * `previous_slug`, a `revoked_slug`, a `slug_history`. If one appeared, a rotated URL
     * would become findable and "that link was retired" would become answerable.
     */
    it('has nowhere to keep a retired slug', async () => {
      const { rows } = await database.client.query<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_schema = 'app' and table_name = 'personal_links'
          order by ordinal_position`,
      );

      expect(rows.map((row) => row.column_name)).toEqual([
        'owner_id',
        'slug',
        'created_at',
        'rotated_at',
      ]);
    });

    it('refuses two owners sharing a slug', async () => {
      const [ownerA, ownerB] = await Promise.all([seedUser(database), seedUser(database)]);

      await database.client.query(
        `insert into app.personal_links (owner_id, slug, created_at) values ($1, 'sharedslug', now())`,
        [ownerA],
      );

      await expect(
        database.client.query(
          `insert into app.personal_links (owner_id, slug, created_at) values ($1, 'sharedslug', now())`,
          [ownerB],
        ),
      ).rejects.toThrow(/duplicate key/);

      await database.client.query(`delete from app.personal_links`);
    });
  });

  describe('app.connection_requests — the state machine and the open-per-pair rule', () => {
    it('has exactly the columns the aggregate carries, and no note', async () => {
      // ⚠ **No content column, and the absence is the decision** (ADR-0018 D4): free text
      // from an unrequested stranger is an abuse channel with a moderation queue attached.
      const { rows } = await database.client.query<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_schema = 'app' and table_name = 'connection_requests'
          order by ordinal_position`,
      );

      expect(rows.map((row) => row.column_name)).toEqual([
        'id',
        'owner_id',
        'requester_id',
        'status',
        'created_at',
        'decided_at',
      ]);
    });

    it('constrains status to the three states, with no `expired` among them', async () => {
      // ⚠ Expiry is arithmetic on `created_at`, never a stored state — a stored one needs a
      // cron and is wrong for as long as the cron is behind (ADR-0018 D5).
      const { rows } = await database.client.query<{ definition: string }>(
        `select pg_catalog.pg_get_constraintdef(oid) as definition
           from pg_catalog.pg_constraint
          where conrelid = 'app.connection_requests'::regclass and conname = 'connection_requests_status'`,
      );

      const definition = rows[0]?.definition ?? '';
      expect(definition).toContain('pending');
      expect(definition).toContain('accepted');
      expect(definition).toContain('declined');
      expect(definition).not.toContain('expired');
    });

    it('keeps status and decided_at in agreement, in both directions', async () => {
      const owner = await seedUser(database);
      const requester = await seedUser(database);

      // A pending row carrying a decision time is refused…
      await expect(
        database.client.query(
          `insert into app.connection_requests (owner_id, requester_id, status, created_at, decided_at)
           values ($1, $2, 'pending', now(), now())`,
          [owner, requester],
        ),
      ).rejects.toThrow(/connection_requests_decided_at/);

      // …and so is a decided row carrying none. The equality form says both in one
      // constraint, rather than two implications a later editor could half-delete.
      await expect(
        database.client.query(
          `insert into app.connection_requests (owner_id, requester_id, status, created_at)
           values ($1, $2, 'accepted', now())`,
          [owner, requester],
        ),
      ).rejects.toThrow(/connection_requests_decided_at/);
    });

    it('refuses a request from somebody to themselves', async () => {
      const person = await seedUser(database);

      await expect(
        database.client.query(
          `insert into app.connection_requests (owner_id, requester_id, status, created_at)
           values ($1, $1, 'pending', now())`,
          [person],
        ),
      ).rejects.toThrow(/connection_requests_distinct_parties/);
    });

    /*
     * ⚠ **Partial on `pending`, and both halves matter.** The uniqueness is what makes a
     * double-tap produce one row rather than two; the partiality is what lets a declined
     * pair ask again — a refusal the requester cannot see must not also be a decision they
     * can never revisit.
     */
    it('allows one open request per pair, and frees the pair once it is decided', async () => {
      const owner = await seedUser(database);
      const requester = await seedUser(database);

      await database.client.query(
        `insert into app.connection_requests (owner_id, requester_id, status, created_at)
         values ($1, $2, 'pending', now())`,
        [owner, requester],
      );

      await expect(
        database.client.query(
          `insert into app.connection_requests (owner_id, requester_id, status, created_at)
           values ($1, $2, 'pending', now())`,
          [owner, requester],
        ),
      ).rejects.toThrow(/duplicate key/);

      await database.client.query(
        `update app.connection_requests set status = 'declined', decided_at = now()
          where owner_id = $1 and requester_id = $2`,
        [owner, requester],
      );

      // The same pair, asking again after a decline. Nothing throws.
      await database.client.query(
        `insert into app.connection_requests (owner_id, requester_id, status, created_at)
         values ($1, $2, 'pending', now())`,
        [owner, requester],
      );

      await database.client.query(`delete from app.connection_requests`);
    });

    it('indexes the owner’s pending rows and the owner’s recent rows — the inbox and the rate window', async () => {
      const { rows } = await database.client.query<{ indexdef: string }>(
        `select indexdef from pg_catalog.pg_indexes
          where schemaname = 'app' and tablename = 'connection_requests'`,
      );
      const definitions = rows.map((row) => row.indexdef);

      // The cap count and the inbox read share this one; the rate window needs the other,
      // which spans every status because a declined burst still consumed the budget.
      expect(
        definitions.some((definition) => /owner_id/.test(definition) && /pending/.test(definition)),
      ).toBe(true);
      expect(
        definitions.some(
          (definition) =>
            /owner_id/.test(definition) &&
            /created_at/.test(definition) &&
            !/WHERE/i.test(definition),
        ),
      ).toBe(true);
    });
  });
});

/** Seed one onboarded user with the superuser client, so fixtures never go through a port. */
async function seedUser(database: PostgresTestDatabase): Promise<string> {
  const { rows } = await database.client.query<{ id: string }>(
    `insert into app.users (auth_user_id, handle, display_name, created_at)
     values (pg_catalog.gen_random_uuid(), 'u' || pg_catalog.substr(pg_catalog.gen_random_uuid()::text, 1, 12), 'Seeded', now())
     returning id`,
  );

  const id = rows[0]?.id;
  if (id === undefined) {
    throw new Error('seedUser: no row returned');
  }

  return id;
}

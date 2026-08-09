import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startPostgresTestDatabase, type PostgresTestDatabase } from '@playa-post/testing';

/**
 * `app.notes` and `app.visible_notes` — issue #88, decision D6.
 *
 * Migration-shape assertions, same discipline as
 * `modules/bulletins/tests/integration/visible-bulletins-migration.integration.test.ts`:
 * catalog facts about the table and the function, plus the one text fact that a migration
 * cannot express — that the checked-in
 * `modules/notes/persistence/sql/visible-notes.sql` appears verbatim in exactly one
 * migration. The composition rules over that same text are
 * `visible-notes-sql-composition.unit.test.ts`'s job instead.
 *
 * ADR-0002 makes two properties non-negotiable for every `app.visible_*` function —
 * **`SECURITY INVOKER`** and **`SET search_path = ''`** — and two for every `app` table:
 * the §4 RLS backstop and an explicit grant to `app_rw` alone.
 */
describe('app.notes and app.visible_notes(viewer_id uuid) — issue #88', () => {
  let database: PostgresTestDatabase;

  beforeAll(async () => {
    database = await startPostgresTestDatabase();
  }, 300_000);

  afterAll(async () => {
    await database?.stop();
  });

  describe('app.notes', () => {
    it('exists as a table in schema app', async () => {
      const { rows } = await database.client.query<{ exists: boolean }>(
        `select exists (
           select 1 from pg_catalog.pg_class c
           join pg_catalog.pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'app' and c.relname = 'notes' and c.relkind = 'r'
         ) as exists`,
      );
      expect(rows[0]?.exists).toBe(true);
    });

    it('has RLS enabled and forced (ADR-0002 §4 backstop)', async () => {
      const { rows } = await database.client.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
        `select c.relrowsecurity, c.relforcerowsecurity
           from pg_catalog.pg_class c
           join pg_catalog.pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'app' and c.relname = 'notes'`,
      );
      expect(rows[0]?.relrowsecurity).toBe(true);
      expect(rows[0]?.relforcerowsecurity).toBe(true);
    });

    it('grants table privileges to app_rw and to no untrusted role', async () => {
      for (const grantee of ['anon', 'authenticated', 'public']) {
        const { rows } = await database.client.query<{ has_privilege: boolean }>(
          `select pg_catalog.has_table_privilege($1, 'app.notes', 'SELECT') as has_privilege`,
          [grantee],
        );
        expect(rows[0]?.has_privilege, `${grantee} must not be able to read app.notes`).toBe(false);
      }

      const { rows } = await database.client.query<{ has_privilege: boolean }>(
        `select pg_catalog.has_table_privilege('app_rw', 'app.notes', 'INSERT') as has_privilege`,
      );
      expect(rows[0]?.has_privilege).toBe(true);
    });

    it('refuses a note addressed to its own author', async () => {
      // The `notes_distinct_parties` backstop. The pin path can never produce one —
      // nobody is at degree 1 of themselves — so this is the constraint proving it would
      // still be refused if a second writer ever appeared.
      const { rows } = await database.client.query<{ id: string }>(
        `insert into app.users (auth_user_id, handle, display_name, created_at)
         values (pg_catalog.gen_random_uuid(), 'dusty_self_note', 'Dusty', now()) returning id`,
      );
      const userId = rows[0]?.id;

      await expect(
        database.client.query(
          `insert into app.notes (author_id, recipient_id, body, created_at)
           values ($1, $1, 'a note to myself', now())`,
          [userId],
        ),
      ).rejects.toThrow(/notes_distinct_parties/);
    });

    it('carries no tsvector column — a note is never searchable', async () => {
      // The structural half of "a note must never become a people search". There is no
      // query grammar over notes and there must be no index that could grow one.
      const { rows } = await database.client.query<{ count: string }>(
        `select count(*)::text as count
           from pg_catalog.pg_attribute a
           join pg_catalog.pg_class c on c.oid = a.attrelid
           join pg_catalog.pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'app' and c.relname = 'notes'
            and a.atttypid = 'pg_catalog.tsvector'::pg_catalog.regtype`,
      );
      expect(rows[0]?.count).toBe('0');
    });
  });

  describe('app.visible_notes', () => {
    it('exists as a function in schema app named visible_notes', async () => {
      const { rows } = await database.client.query<{ exists: boolean }>(
        `select exists (
           select 1 from pg_catalog.pg_proc p
           join pg_catalog.pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'app' and p.proname = 'visible_notes'
         ) as exists`,
      );
      expect(rows[0]?.exists).toBe(true);
    });

    it('takes a viewer_id uuid argument', async () => {
      const { rows } = await database.client.query<{ arguments: string }>(
        `select pg_catalog.pg_get_function_arguments(p.oid) as arguments
           from pg_catalog.pg_proc p
           join pg_catalog.pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'app' and p.proname = 'visible_notes'`,
      );
      expect(rows[0]?.arguments).toMatch(/viewer_id\s+uuid/i);
    });

    it('is SECURITY INVOKER (ADR-0004:25) — never DEFINER, per the B4 allowlist discipline', async () => {
      const { rows } = await database.client.query<{ prosecdef: boolean }>(
        `select p.prosecdef
           from pg_catalog.pg_proc p
           join pg_catalog.pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'app' and p.proname = 'visible_notes'`,
      );
      expect(rows[0]?.prosecdef).toBe(false);
    });

    it("pins SET search_path = '' (ADR-0002:164)", async () => {
      const { rows } = await database.client.query<{ proconfig: string[] | null }>(
        `select p.proconfig
           from pg_catalog.pg_proc p
           join pg_catalog.pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'app' and p.proname = 'visible_notes'`,
      );
      // ⚠ `search_path=""`, not `search_path=` — see visible-people-migration's
      // identical comment; measured against PostgreSQL 17.
      expect(rows[0]?.proconfig ?? []).toEqual(expect.arrayContaining(['search_path=""']));
    });

    /**
     * Same discipline as `visible-bulletins-migration.integration.test.ts`'s identically
     * named test: containment, not a `pg_proc.prosrc` comparison, because PostgreSQL
     * normalises a stored function body.
     */
    it('installs the checked-in modules/notes/persistence/sql/visible-notes.sql verbatim, from exactly one migration', async () => {
      const checkedIn = (
        await readFile(
          fileURLToPath(new URL('../../persistence/sql/visible-notes.sql', import.meta.url)),
          'utf8',
        )
      ).trim();

      const migrationsDirectory = database.migrationsDirectory;
      if (migrationsDirectory === null) {
        throw new Error('this suite runs against the repository migrations, not an empty schema');
      }

      const carrying: string[] = [];
      for (const filename of database.appliedMigrations) {
        const text = await readFile(join(migrationsDirectory, filename), 'utf8');
        if (text.includes(checkedIn)) {
          carrying.push(filename);
        }
      }

      expect(
        carrying,
        'the checked-in visible-notes.sql must appear verbatim in exactly one migration',
      ).toHaveLength(1);
    });

    it('grants EXECUTE to app_rw and to no other role (schema-wide B3 rule, named here for this function)', async () => {
      for (const grantee of ['anon', 'authenticated', 'public']) {
        const { rows } = await database.client.query<{ has_privilege: boolean }>(
          `select pg_catalog.has_function_privilege($1, 'app.visible_notes(uuid)', 'EXECUTE') as has_privilege`,
          [grantee],
        );
        expect(
          rows[0]?.has_privilege,
          `${grantee} must not be able to execute app.visible_notes`,
        ).toBe(false);
      }

      // Both halves, matching the table-grant test above. The negative half alone passes
      // just as happily against a function nobody can execute — including one the
      // migration forgot to grant, or one a later `create or replace` dropped the grant
      // from — and a green suite over a dead read path is worse than a red one.
      const { rows } = await database.client.query<{ has_privilege: boolean }>(
        `select pg_catalog.has_function_privilege('app_rw', 'app.visible_notes(uuid)', 'EXECUTE') as has_privilege`,
      );
      expect(rows[0]?.has_privilege).toBe(true);
    });
  });
});

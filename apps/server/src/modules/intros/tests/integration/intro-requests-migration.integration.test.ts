import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startPostgresTestDatabase, type PostgresTestDatabase } from '@playa-post/testing';

/**
 * `app.intro_requests` and `app.intro_via_candidates` — issue #89, ACs 15 and 16.
 *
 * Migration-shape assertions, same discipline as
 * `modules/notes/tests/integration/visible-notes-migration.integration.test.ts`: catalog
 * facts about the table and the function, plus the one text fact that a migration cannot
 * express — that the checked-in
 * `modules/intros/persistence/sql/intro-via-candidates.sql` appears verbatim in exactly
 * one migration. The composition rules over that same text are
 * `intro-via-candidates-sql-composition.unit.test.ts`'s job instead.
 *
 * ADR-0002 makes two properties non-negotiable for every authorized-set function —
 * **`SECURITY INVOKER`** and **`SET search_path = ''`** — and two for every `app` table:
 * the §4 RLS backstop and an explicit grant to `app_rw` alone.
 */
describe('app.intro_requests and app.intro_via_candidates — issue #89', () => {
  let database: PostgresTestDatabase;

  beforeAll(async () => {
    database = await startPostgresTestDatabase();
  }, 300_000);

  afterAll(async () => {
    await database?.stop();
  });

  /** Three fresh people, so a constraint test is never about a leftover row. */
  async function seedUsers(count: number): Promise<readonly string[]> {
    const ids: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const handle = `dusty_intro_shape_${randomUUID().slice(0, 8)}`;
      const { rows } = await database.client.query<{ id: string }>(
        `insert into app.users (auth_user_id, handle, display_name, created_at)
         values (pg_catalog.gen_random_uuid(), $1, $2, now()) returning id`,
        [handle, handle],
      );
      const id = rows[0]?.id;
      if (id === undefined) {
        throw new Error('seedUsers: insert returned no row');
      }
      ids.push(id);
    }
    return ids;
  }

  async function insertIntroRequest(
    requesterId: string,
    viaId: string,
    targetId: string,
    status = 'requested',
    decidedAt: string | null = null,
  ): Promise<void> {
    await database.client.query(
      `insert into app.intro_requests
         (requester_id, via_id, target_id, note, status, created_at, decided_at)
       values ($1, $2, $3, 'why we should meet', $4, now(), $5)`,
      [requesterId, viaId, targetId, status, decidedAt],
    );
  }

  describe('app.intro_requests', () => {
    it('exists as a table in schema app', async () => {
      const { rows } = await database.client.query<{ exists: boolean }>(
        `select exists (
           select 1 from pg_catalog.pg_class c
           join pg_catalog.pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'app' and c.relname = 'intro_requests' and c.relkind = 'r'
         ) as exists`,
      );
      expect(rows[0]?.exists).toBe(true);
    });

    it('has RLS enabled and forced (ADR-0002 §4 backstop)', async () => {
      const { rows } = await database.client.query<{
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(
        `select c.relrowsecurity, c.relforcerowsecurity
           from pg_catalog.pg_class c
           join pg_catalog.pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'app' and c.relname = 'intro_requests'`,
      );
      expect(rows[0]?.relrowsecurity).toBe(true);
      expect(rows[0]?.relforcerowsecurity).toBe(true);
    });

    it('carries exactly the app_rw_full_access backstop policy and no hand-written second one', async () => {
      // A second policy on this table would be somebody expressing an authorization rule
      // in RLS that the application already expresses in SQL — two answers, and the
      // database's would win silently.
      const { rows } = await database.client.query<{ policyname: string }>(
        `select p.policyname
           from pg_catalog.pg_policies p
          where p.schemaname = 'app' and p.tablename = 'intro_requests'`,
      );
      expect(rows.map((row) => row.policyname)).toEqual(['app_rw_full_access']);
    });

    it('grants table privileges to app_rw and to no untrusted role', async () => {
      for (const grantee of ['anon', 'authenticated', 'public']) {
        const { rows } = await database.client.query<{ has_privilege: boolean }>(
          `select pg_catalog.has_table_privilege($1, 'app.intro_requests', 'SELECT') as has_privilege`,
          [grantee],
        );
        expect(
          rows[0]?.has_privilege,
          `${grantee} must not be able to read app.intro_requests`,
        ).toBe(false);
      }

      for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        const { rows } = await database.client.query<{ has_privilege: boolean }>(
          `select pg_catalog.has_table_privilege('app_rw', 'app.intro_requests', $1) as has_privilege`,
          [privilege],
        );
        expect(rows[0]?.has_privilege, `app_rw needs ${privilege}`).toBe(true);
      }
    });

    it('refuses a request where any two parties are the same person', async () => {
      const [alice, bob] = await seedUsers(2);
      if (alice === undefined || bob === undefined) {
        throw new Error('seedUsers returned too few rows');
      }

      // The sanctioned path can never produce one — `app.intro_via_candidates` returns
      // only degree-1 people for a degree-2 target — so this is the constraint proving it
      // would still be refused if a second writer ever appeared.
      await expect(insertIntroRequest(alice, alice, bob)).rejects.toThrow(
        /intro_requests_distinct_parties/,
      );
      await expect(insertIntroRequest(alice, bob, bob)).rejects.toThrow(
        /intro_requests_distinct_parties/,
      );
      await expect(insertIntroRequest(alice, bob, alice)).rejects.toThrow(
        /intro_requests_distinct_parties/,
      );
    });

    it('refuses a status outside the three shipped values', async () => {
      const [requester, via, target] = await seedUsers(3);
      if (requester === undefined || via === undefined || target === undefined) {
        throw new Error('seedUsers returned too few rows');
      }

      // decided_at set, so the equality CHECK is satisfied and the status CHECK is
      // the one the insert can only fail on.
      await expect(
        insertIntroRequest(requester, via, target, 'withdrawn', new Date().toISOString()),
      ).rejects.toThrow(/intro_requests_status/);
    });

    it('refuses a decided row with no decided_at, and an open row that has one', async () => {
      const [requester, via, target] = await seedUsers(3);
      if (requester === undefined || via === undefined || target === undefined) {
        throw new Error('seedUsers returned too few rows');
      }

      // Both directions, because the constraint is an equality and a later editor
      // rewriting it as one implication would leave half of it enforced.
      await expect(
        insertIntroRequest(requester, via, target, 'passed_on', null),
      ).rejects.toThrow(/intro_requests_decided_at/);
      await expect(
        insertIntroRequest(requester, via, target, 'requested', new Date().toISOString()),
      ).rejects.toThrow(/intro_requests_decided_at/);
    });

    it('allows one open request per (requester, target) and refuses a second, whatever the via', async () => {
      const [requester, viaOne, viaTwo, target] = await seedUsers(4);
      if (
        requester === undefined ||
        viaOne === undefined ||
        viaTwo === undefined ||
        target === undefined
      ) {
        throw new Error('seedUsers returned too few rows');
      }

      await insertIntroRequest(requester, viaOne, target);

      // **The anti-spam control.** Without it a requester fans one ask out to every
      // shared connection and the target hears about it from all of them.
      await expect(insertIntroRequest(requester, viaTwo, target)).rejects.toThrow(
        /intro_requests_open_per_pair_idx/,
      );
    });

    it('is partial, so a decided request leaves the pair free to ask again', async () => {
      const [requester, viaOne, viaTwo, target] = await seedUsers(4);
      if (
        requester === undefined ||
        viaOne === undefined ||
        viaTwo === undefined ||
        target === undefined
      ) {
        throw new Error('seedUsers returned too few rows');
      }

      await insertIntroRequest(
        requester,
        viaOne,
        target,
        'declined',
        new Date().toISOString(),
      );

      // A declined request imposes no cooldown, which is a known gap rather than an
      // oversight — recorded as a follow-up on #89 and asserted here so a future cooldown
      // arrives as a deliberate change to this test rather than as a surprise.
      await expect(insertIntroRequest(requester, viaTwo, target)).resolves.toBeUndefined();
    });

    describe('via_note (issue #175)', () => {
      /** Insert with an explicit `via_note`, so the CHECK is the only thing that can refuse. */
      async function insertWithViaNote(
        requesterId: string,
        viaId: string,
        targetId: string,
        status: string,
        viaNote: string | null,
      ): Promise<void> {
        await database.client.query(
          `insert into app.intro_requests
             (requester_id, via_id, target_id, note, via_note, status, created_at, decided_at)
           values ($1, $2, $3, 'why we should meet', $4, $5, now(), $6)`,
          [
            requesterId,
            viaId,
            targetId,
            viaNote,
            status,
            status === 'requested' ? null : new Date().toISOString(),
          ],
        );
      }

      it('exists as a nullable text column', async () => {
        const { rows } = await database.client.query<{
          data_type: string;
          is_nullable: string;
        }>(
          `select a.atttypid::pg_catalog.regtype::text as data_type,
                  case when a.attnotnull then 'NO' else 'YES' end as is_nullable
             from pg_catalog.pg_attribute a
             join pg_catalog.pg_class c on c.oid = a.attrelid
             join pg_catalog.pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'app' and c.relname = 'intro_requests' and a.attname = 'via_note'`,
        );

        // Nullable, because three legitimate situations produce no via note: the request
        // is open, it was declined, or it was passed on before #175 asked for one.
        expect(rows[0]?.data_type).toBe('text');
        expect(rows[0]?.is_nullable).toBe('YES');
      });

      it('refuses a via note on a request that was not passed on', async () => {
        const [requester, via, target] = await seedUsers(3);
        if (requester === undefined || via === undefined || target === undefined) {
          throw new Error('seedUsers returned too few rows');
        }

        // A note attached to a decline has no reader — the requester is told only that it
        // was not passed on — and one on an open request describes a decision nobody has
        // made. The domain refuses both; this is the backstop that would still refuse
        // them if a second writer ever appeared.
        await expect(
          insertWithViaNote(requester, via, target, 'declined', 'not for you'),
        ).rejects.toThrow(/intro_requests_via_note/);
        await expect(
          insertWithViaNote(requester, via, target, 'requested', 'too early'),
        ).rejects.toThrow(/intro_requests_via_note/);
      });

      it('allows a passed-on request with a via note, and one without', async () => {
        const [requester, via, target, other] = await seedUsers(4);
        if (
          requester === undefined ||
          via === undefined ||
          target === undefined ||
          other === undefined
        ) {
          throw new Error('seedUsers returned too few rows');
        }

        await expect(
          insertWithViaNote(requester, via, target, 'passed_on', 'they should meet'),
        ).resolves.toBeUndefined();

        // ⚠ **An implication, not the equality `intro_requests_decided_at` uses.** Rows
        // passed on before this column existed carry no note and must stay valid forever
        // — migrations are forward-only, so a biconditional here would have refused to
        // apply against any database with history in it. "Every *new* pass-on has one" is
        // the domain's claim (`intro-note.policy.ts`), asserted in the feature suite.
        await expect(
          insertWithViaNote(requester, via, other, 'passed_on', null),
        ).resolves.toBeUndefined();
      });

      it('is not part of any index — a vouch is no more searchable than the ask', async () => {
        // The structural half of the same rule `note` is held to. There is no query
        // grammar over intro requests and there must be no index that could grow one.
        const { rows } = await database.client.query<{ count: string }>(
          `select count(*)::text as count
             from pg_catalog.pg_index i
             join pg_catalog.pg_class c on c.oid = i.indrelid
             join pg_catalog.pg_namespace n on n.oid = c.relnamespace
             join pg_catalog.pg_attribute a
               on a.attrelid = c.oid and a.attnum = any (i.indkey)
            where n.nspname = 'app' and c.relname = 'intro_requests'
              and a.attname = 'via_note'`,
        );
        expect(rows[0]?.count).toBe('0');
      });
    });

    it('carries no tsvector column — an intro request is never searchable', async () => {
      // The structural half of "an intro note must never become a people search". There
      // is no query grammar over intro requests and there must be no index that could
      // grow one.
      const { rows } = await database.client.query<{ count: string }>(
        `select count(*)::text as count
           from pg_catalog.pg_attribute a
           join pg_catalog.pg_class c on c.oid = a.attrelid
           join pg_catalog.pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'app' and c.relname = 'intro_requests'
            and a.atttypid = 'pg_catalog.tsvector'::pg_catalog.regtype`,
      );
      expect(rows[0]?.count).toBe('0');
    });
  });

  describe('app.intro_via_candidates', () => {
    it('exists as a function in schema app taking two uuid arguments', async () => {
      const { rows } = await database.client.query<{ arguments: string }>(
        `select pg_catalog.pg_get_function_arguments(p.oid) as arguments
           from pg_catalog.pg_proc p
           join pg_catalog.pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'app' and p.proname = 'intro_via_candidates'`,
      );
      expect(rows[0]?.arguments).toMatch(/requester_id\s+uuid.*target_id\s+uuid/is);
    });

    it('is SECURITY INVOKER (ADR-0004:25) — never DEFINER, per the B4 allowlist discipline', async () => {
      const { rows } = await database.client.query<{ prosecdef: boolean }>(
        `select p.prosecdef
           from pg_catalog.pg_proc p
           join pg_catalog.pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'app' and p.proname = 'intro_via_candidates'`,
      );
      expect(rows[0]?.prosecdef).toBe(false);
    });

    it("pins SET search_path = '' (ADR-0002:164)", async () => {
      const { rows } = await database.client.query<{ proconfig: string[] | null }>(
        `select p.proconfig
           from pg_catalog.pg_proc p
           join pg_catalog.pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'app' and p.proname = 'intro_via_candidates'`,
      );
      // ⚠ `search_path=""`, not `search_path=` — see visible-people-migration's
      // identical comment; measured against PostgreSQL 17.
      expect(rows[0]?.proconfig ?? []).toEqual(expect.arrayContaining(['search_path=""']));
    });

    it('is STABLE — it reads and never writes', async () => {
      // `provolatile`: 'i' immutable, 's' stable, 'v' volatile. A volatile function would
      // be re-planned per row inside the two gated write statements that call it.
      const { rows } = await database.client.query<{ provolatile: string }>(
        `select p.provolatile
           from pg_catalog.pg_proc p
           join pg_catalog.pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'app' and p.proname = 'intro_via_candidates'`,
      );
      expect(rows[0]?.provolatile).toBe('s');
    });

    /**
     * Same discipline as `visible-notes-migration.integration.test.ts`'s identically
     * named test: containment, not a `pg_proc.prosrc` comparison, because PostgreSQL
     * normalises a stored function body.
     */
    it('installs the checked-in modules/intros/persistence/sql/intro-via-candidates.sql verbatim, from exactly one migration', async () => {
      const checkedIn = (
        await readFile(
          fileURLToPath(new URL('../../persistence/sql/intro-via-candidates.sql', import.meta.url)),
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
        'the checked-in intro-via-candidates.sql must appear verbatim in exactly one migration',
      ).toHaveLength(1);
    });

    it('grants EXECUTE to app_rw and to no other role', async () => {
      for (const grantee of ['anon', 'authenticated', 'public']) {
        const { rows } = await database.client.query<{ has_privilege: boolean }>(
          `select pg_catalog.has_function_privilege(
                    $1, 'app.intro_via_candidates(uuid, uuid)', 'EXECUTE'
                  ) as has_privilege`,
          [grantee],
        );
        expect(
          rows[0]?.has_privilege,
          `${grantee} must not be able to execute app.intro_via_candidates`,
        ).toBe(false);
      }

      // Both halves, matching the table-grant test above. The negative half alone passes
      // just as happily against a function nobody can execute — including one the
      // migration forgot to grant — and a green suite over a dead read path is worse than
      // a red one.
      const { rows } = await database.client.query<{ has_privilege: boolean }>(
        `select pg_catalog.has_function_privilege(
                  'app_rw', 'app.intro_via_candidates(uuid, uuid)', 'EXECUTE'
                ) as has_privilege`,
      );
      expect(rows[0]?.has_privilege).toBe(true);
    });
  });
});

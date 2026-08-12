import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { startPostgresTestDatabase, type PostgresTestDatabase } from '@playa-post/testing';

import type { Configuration } from '../../apps/server/src/composition/config';
import { buildAppContainer, type AppContainer } from '../../apps/server/src/composition/container';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/** The instant every round below believes it is running at. */
const NOW = new Date('2026-08-12T12:00:00.000Z');

/** `NOW` less `days`, so each fixture's age reads as the number in its own name. */
function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * MILLISECONDS_PER_DAY);
}

/**
 * The soft-delete purge, end to end against real Postgres (issue #169, decision D17,
 * closing the gap [#118] named).
 *
 * ⚠ **Driven through `buildAppContainer`, not two hand-wired module factories**, and that
 * is the point rather than convenience. The sweep is composed in exactly one place — the
 * `targets` array in `composition/container.ts` — and every failure mode of this feature
 * that a module-level suite cannot see lives there: a target left out of the array is a
 * store that silently accumulates deleted rows forever, and nothing throws, nothing logs,
 * and every module's own tests stay green. `container-notification-wiring.integration.test.ts`
 * exists for the identical reason on the drainer's consumer list.
 *
 * ⚠ **Lives at `tests/integration/` because it is owned by no module.** It asserts over
 * `modules/views`' table, `modules/bulletins`' table, and `modules/moderation`'s two
 * dependents at once, and the thing under test is addressed by a clock rather than by an
 * actor. Its per-module halves are elsewhere: the saved view's soft delete is proved in
 * `modules/views/tests/integration/saved-view.integration.test.ts`, and the bulletin's
 * `archived_at` was already proved by M2-AC12.
 *
 * The catalog block below is here rather than in a module's schema suite for the same
 * reason: those facts are *what this sweep needs to be true*, and one of them
 * (`ON DELETE CASCADE`) is on a table neither module that needs it owns.
 */
describe('soft-deleted rows are purged after the retention window (#169, D17)', () => {
  let testDatabase: PostgresTestDatabase;

  beforeAll(async () => {
    testDatabase = await startPostgresTestDatabase();
    await testDatabase.client.query(`alter role app_rw with password 'purge_app_rw_password'`);
  }, 300_000);

  afterEach(async () => {
    await testDatabase.truncateAllTables();
  });

  afterAll(async () => {
    await testDatabase?.stop();
  });

  /**
   * A container whose retention window is `retentionDays`.
   *
   * Built per test rather than once, because the window is what several of these
   * scenarios vary — and building one opens no socket (see `buildAppContainer`).
   */
  function containerWithRetention(retentionDays: number): AppContainer {
    const configuration: Configuration = {
      nodeEnv: 'test',
      host: '127.0.0.1',
      port: 0,
      logLevel: 'silent',
      databaseUrl: asRole(testDatabase.connectionString, 'app_rw', 'purge_app_rw_password'),
      // Never fetched: nothing in this suite authenticates. The container still needs the
      // value to build its verifier, and building one opens no socket.
      supabaseUrl: 'http://127.0.0.1:1/unused-by-this-suite',
      purgeRetentionDays: retentionDays,
      webPush: null,
    };

    return buildAppContainer(configuration);
  }

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

  /** A bulletin, optionally already removed at a given instant. */
  async function seedBulletin(
    authorId: string,
    title: string,
    archivedAt: Date | null,
  ): Promise<string> {
    const { rows } = await testDatabase.client.query<{ id: string }>(
      `insert into app.bulletins (author_id, type, title, body, created_at, archived_at)
       values ($1, 'request', $2, 'body', $3, $4) returning id`,
      [authorId, title, daysAgo(90), archivedAt],
    );
    const bulletinId = rows[0]?.id;
    if (bulletinId === undefined) {
      throw new Error('seedBulletin: insert returned no row');
    }
    return bulletinId;
  }

  /** A saved view, optionally already deleted at a given instant. */
  async function seedSavedView(
    ownerId: string,
    name: string,
    deletedAt: Date | null,
  ): Promise<string> {
    const { rows } = await testDatabase.client.query<{ id: string }>(
      `insert into app.saved_views
         (owner_id, name, source_text, ast, ast_version, created_at, updated_at, deleted_at)
       values ($1, $2, 'type:offer', $3, 1, $4, $4, $5) returning id`,
      [ownerId, name, JSON.stringify({ types: ['offer'], text: [] }), daysAgo(90), deletedAt],
    );
    const viewId = rows[0]?.id;
    if (viewId === undefined) {
      throw new Error('seedSavedView: insert returned no row');
    }
    return viewId;
  }

  async function bulletinTitles(): Promise<readonly string[]> {
    const { rows } = await testDatabase.client.query<{ title: string }>(
      `select title from app.bulletins order by title`,
    );
    return rows.map((row) => row.title);
  }

  async function savedViewNames(): Promise<readonly string[]> {
    const { rows } = await testDatabase.client.query<{ name: string }>(
      `select name from app.saved_views order by name`,
    );
    return rows.map((row) => row.name);
  }

  async function countOf(table: string): Promise<number> {
    const { rows } = await testDatabase.client.query<{ count: string }>(
      `select count(*) as count from ${table}`,
    );
    return Number(rows[0]?.count ?? '0');
  }

  /**
   * The catalog facts the sweep rests on.
   *
   * Read from the catalog rather than from the migration's text, matching every other
   * schema suite in this repository: what a `.sql` file says and what the database ended
   * up with are two claims, and only the second one governs at runtime.
   */
  describe('the shape the purge depends on', () => {
    it('gives app.saved_views a nullable deleted_at — absence is the live state', async () => {
      const { rows } = await testDatabase.client.query<{ is_nullable: string; data_type: string }>(
        `select is_nullable, data_type from information_schema.columns
          where table_schema = 'app' and table_name = 'saved_views' and column_name = 'deleted_at'`,
      );

      expect(rows).toEqual([{ is_nullable: 'YES', data_type: 'timestamp with time zone' }]);
    });

    it("cascades a bulletin's reports and dismissals, so a purge cannot be refused by them", async () => {
      // ⚠ Without this the sweep wedges *permanently and silently*: one `NOT NULL`
      // dependent refuses the `DELETE`, every round, and a purge that throws every hour
      // is indistinguishable from one with nothing to do. `confdeltype` is PostgreSQL's
      // own record of the clause — `'c'` is CASCADE, `'a'` is the NO ACTION default these
      // two carried before #169.
      const { rows } = await testDatabase.client.query<{
        conname: string;
        confdeltype: string;
      }>(
        `select c.conname, c.confdeltype
           from pg_catalog.pg_constraint c
           join pg_catalog.pg_class t on t.oid = c.conrelid
           join pg_catalog.pg_class r on r.oid = c.confrelid
           join pg_catalog.pg_namespace n on n.oid = t.relnamespace
          where c.contype = 'f' and n.nspname = 'app' and r.relname = 'bulletins'
          order by c.conname`,
      );

      expect(rows).toEqual([
        { conname: 'bulletin_dismissals_bulletin_id_fkey', confdeltype: 'c' },
        { conname: 'bulletin_reports_bulletin_id_fkey', confdeltype: 'c' },
      ]);
    });

    it("indexes each sweep's predicate, partially — live rows are not part of the question", async () => {
      const { rows } = await testDatabase.client.query<{ indexname: string }>(
        `select indexname from pg_catalog.pg_indexes
          where schemaname = 'app'
            and indexname in ('saved_views_deleted_at_idx', 'bulletins_archived_at_idx')
            and indexdef like '%WHERE%'
          order by indexname`,
      );

      expect(rows.map((row) => row.indexname)).toEqual([
        'bulletins_archived_at_idx',
        'saved_views_deleted_at_idx',
      ]);
    });
  });

  describe('the retention boundary', () => {
    it('removes a bulletin removed before the window and keeps one removed inside it', async () => {
      // AC4 for bulletins, as one assertion with both sides: a boundary test that only
      // proved the old row goes would pass for an implementation that deletes everything.
      const container = containerWithRetention(30);
      try {
        const author = await seedUser('dusty_purge_bulletins');
        await seedBulletin(author, 'removed 31 days ago', daysAgo(31));
        await seedBulletin(author, 'removed 29 days ago', daysAgo(29));
        await seedBulletin(author, 'never removed', null);

        const result = await container.softDeletePurge.purgeOnce({ now: NOW });

        expect(await bulletinTitles()).toEqual(['never removed', 'removed 29 days ago']);
        // The cutoff is asserted alongside the count because each target carries its own
        // window: this is where `configuration.purgeRetentionDays` reaching *this* target
        // is observable, rather than a round-wide number that happened to be right.
        expect(result.purged).toContainEqual({
          name: 'removed bulletins',
          deletedBefore: daysAgo(30),
          rows: 1,
        });
      } finally {
        await container.dispose();
      }
    });

    it('removes a saved view deleted before the window and keeps one deleted inside it', async () => {
      const container = containerWithRetention(30);
      try {
        const owner = await seedUser('dusty_purge_views');
        await seedSavedView(owner, 'deleted 31 days ago', daysAgo(31));
        await seedSavedView(owner, 'deleted 29 days ago', daysAgo(29));
        await seedSavedView(owner, 'never deleted', null);

        const result = await container.softDeletePurge.purgeOnce({ now: NOW });

        expect(await savedViewNames()).toEqual(['deleted 29 days ago', 'never deleted']);
        expect(result.purged).toContainEqual({
          name: 'deleted saved views',
          deletedBefore: daysAgo(30),
          rows: 1,
        });
      } finally {
        await container.dispose();
      }
    });

    it('follows the configured window rather than a thirty baked into the sweep', async () => {
      // AC3, at the level where it could actually be faked: the arithmetic is unit-tested
      // in `entrypoints/purge/`, and this is the proof that the number reaching it comes
      // from `Configuration` all the way through composition.
      const container = containerWithRetention(7);
      try {
        const owner = await seedUser('dusty_purge_window');
        await seedBulletin(owner, 'removed 8 days ago', daysAgo(8));
        await seedBulletin(owner, 'removed 6 days ago', daysAgo(6));
        await seedSavedView(owner, 'deleted 8 days ago', daysAgo(8));
        await seedSavedView(owner, 'deleted 6 days ago', daysAgo(6));

        await container.softDeletePurge.purgeOnce({ now: NOW });

        // Both of these survive a 30-day window and neither survives a 7-day one, so the
        // assertion cannot pass against a hardcoded default.
        expect(await bulletinTitles()).toEqual(['removed 6 days ago']);
        expect(await savedViewNames()).toEqual(['deleted 6 days ago']);
      } finally {
        await container.dispose();
      }
    });

    it('removes nothing on a second sweep, and reports that honestly', async () => {
      const container = containerWithRetention(30);
      try {
        const author = await seedUser('dusty_purge_idempotent');
        await seedBulletin(author, 'removed 31 days ago', daysAgo(31));
        await seedSavedView(author, 'deleted 31 days ago', daysAgo(31));

        const first = await container.softDeletePurge.purgeOnce({ now: NOW });
        const second = await container.softDeletePurge.purgeOnce({ now: NOW });

        expect(first.totalRows).toBe(2);
        expect(second.totalRows).toBe(0);
      } finally {
        await container.dispose();
      }
    });
  });

  describe('what a purged bulletin takes with it', () => {
    it('purges cleanly with a report and a dismissal attached, and both go too', async () => {
      // The failure this exists to catch is not a wrong row count — it is an exception.
      // `app.bulletin_reports.bulletin_id` and `app.bulletin_dismissals.bulletin_id` are
      // `NOT NULL` references, so before the cascade either one refused the `DELETE` and
      // wedged the whole sweep. Any reported or dismissed bulletin was enough.
      const container = containerWithRetention(30);
      try {
        const author = await seedUser('dusty_purge_deps_author');
        const viewer = await seedUser('dusty_purge_deps_viewer');
        const old = await seedBulletin(author, 'removed 31 days ago', daysAgo(31));

        await testDatabase.client.query(
          `insert into app.bulletin_reports (bulletin_id, reporter_id, created_at, reason, detail)
           values ($1, $2, $3, 'spam', 'it is spam')`,
          [old, viewer, daysAgo(40)],
        );
        await testDatabase.client.query(
          `insert into app.bulletin_dismissals (bulletin_id, viewer_id, created_at)
           values ($1, $2, $3)`,
          [old, viewer, daysAgo(40)],
        );

        const result = await container.softDeletePurge.purgeOnce({ now: NOW });

        expect(result.purged).toContainEqual({
          name: 'removed bulletins',
          deletedBefore: daysAgo(30),
          rows: 1,
        });
        expect(await bulletinTitles()).toEqual([]);
        expect(await countOf('app.bulletin_reports')).toBe(0);
        expect(await countOf('app.bulletin_dismissals')).toBe(0);
      } finally {
        await container.dispose();
      }
    });

    it("leaves a retained bulletin's report and dismissal exactly where they were", async () => {
      // The other side of the cascade, and the one that would fail silently: a sweep that
      // deleted moderation rows by its own predicate rather than by the bulletin's would
      // un-hide a bulletin somebody had reported, on their board, with no trace.
      const container = containerWithRetention(30);
      try {
        const author = await seedUser('dusty_purge_deps_kept_author');
        const viewer = await seedUser('dusty_purge_deps_kept_viewer');
        const old = await seedBulletin(author, 'removed 31 days ago', daysAgo(31));
        const recent = await seedBulletin(author, 'removed 29 days ago', daysAgo(29));

        for (const bulletinId of [old, recent]) {
          await testDatabase.client.query(
            `insert into app.bulletin_reports (bulletin_id, reporter_id, created_at, reason, detail)
             values ($1, $2, $3, 'spam', 'it is spam')`,
            [bulletinId, viewer, daysAgo(40)],
          );
          await testDatabase.client.query(
            `insert into app.bulletin_dismissals (bulletin_id, viewer_id, created_at)
             values ($1, $2, $3)`,
            [bulletinId, viewer, daysAgo(40)],
          );
        }

        await container.softDeletePurge.purgeOnce({ now: NOW });

        const { rows: reports } = await testDatabase.client.query<{ bulletin_id: string }>(
          `select bulletin_id from app.bulletin_reports`,
        );
        const { rows: dismissals } = await testDatabase.client.query<{ bulletin_id: string }>(
          `select bulletin_id from app.bulletin_dismissals`,
        );

        expect(reports.map((row) => row.bulletin_id)).toEqual([recent]);
        expect(dismissals.map((row) => row.bulletin_id)).toEqual([recent]);
      } finally {
        await container.dispose();
      }
    });

    it('does not wedge on a Notify Me designation the delete path failed to clear', async () => {
      // ⚠ A state no service can produce — `SavedViewRepository#delete` clears the
      // designation in the same transaction, and `setNotify` refuses a deleted view — so
      // it is written here with raw SQL, exactly as this repository's other
      // unreachable-by-design assertions are. The FK used to enforce the ordering by
      // making the view row disappear; a soft-deleted row satisfies it, so the guarantee
      // now rests on one predicate in one file. If that predicate is ever lost, this is
      // what fails — instead of the sweep throwing every hour in production, forever,
      // looking exactly like a sweep with nothing to do.
      const container = containerWithRetention(30);
      try {
        const owner = await seedUser('dusty_purge_stray_designation');
        const view = await seedSavedView(owner, 'deleted 31 days ago', daysAgo(31));

        await testDatabase.client.query(
          `insert into app.notify_me_queries
             (owner_id, source_text, ast, ast_version, updated_at, source_view_id)
           values ($1, 'type:offer', $2, 1, $3, $4)`,
          [owner, JSON.stringify({ types: ['offer'], text: [] }), daysAgo(31), view],
        );

        const result = await container.softDeletePurge.purgeOnce({ now: NOW });

        expect(result.purged).toContainEqual({
          name: 'deleted saved views',
          deletedBefore: daysAgo(30),
          rows: 1,
        });
        expect(await savedViewNames()).toEqual([]);
        expect(await countOf('app.notify_me_queries')).toBe(0);
      } finally {
        await container.dispose();
      }
    });
  });

  describe('what the purge does not do', () => {
    it("publishes nothing — retention housekeeping is not a fact about anybody's state", async () => {
      const container = containerWithRetention(30);
      try {
        const author = await seedUser('dusty_purge_outbox');
        await seedBulletin(author, 'removed 31 days ago', daysAgo(31));
        await seedSavedView(author, 'deleted 31 days ago', daysAgo(31));

        await container.softDeletePurge.purgeOnce({ now: NOW });

        // An event here would say "this was deleted" about something already absent from
        // every read for a month, and would durably record that a person deleted
        // something long after the fact (ADR-0006, M2-AC16).
        expect(await countOf('app.outbox_events')).toBe(0);
      } finally {
        await container.dispose();
      }
    });

    it('never touches a bulletin that merely expired, however long ago', async () => {
      // Expiry is not removal: an elapsed `expires_at` takes a bulletin off every board
      // and leaves it its author's. Sweeping on it would delete content nobody asked to
      // be rid of — and `bulletins.listMine` is where the author would notice, eventually.
      const container = containerWithRetention(30);
      try {
        const author = await seedUser('dusty_purge_expired');
        await testDatabase.client.query(
          `insert into app.bulletins (author_id, type, title, body, created_at, expires_at)
           values ($1, 'request', 'expired a year ago', 'body', $2, $3)`,
          [author, daysAgo(400), daysAgo(365)],
        );

        await container.softDeletePurge.purgeOnce({ now: NOW });

        expect(await bulletinTitles()).toEqual(['expired a year ago']);
      } finally {
        await container.dispose();
      }
    });

    it('never touches a note, which has no delete to be soft about', async () => {
      // Decision D17. `app.notes` carries no lifecycle column at all (D6's "no
      // lifecycle", kept by D14), so there is nothing here for a target to sweep — and no
      // target is wired for it. Asserted rather than assumed, because "we did not build
      // that" and "we built it and it deletes everything" look the same until somebody
      // looks.
      const container = containerWithRetention(30);
      try {
        const author = await seedUser('dusty_purge_notes_author');
        const recipient = await seedUser('dusty_purge_notes_recipient');
        await testDatabase.client.query(
          `insert into app.notes (author_id, recipient_id, body, created_at)
           values ($1, $2, 'a note from a year ago', $3)`,
          [author, recipient, daysAgo(400)],
        );

        await container.softDeletePurge.purgeOnce({ now: NOW });

        expect(await countOf('app.notes')).toBe(1);
      } finally {
        await container.dispose();
      }
    });
  });
});

/** The connection string with its role and password replaced, as the sibling suites do. */
function asRole(connectionString: string, role: string, password: string): string {
  const url = new URL(connectionString);
  url.username = role;
  url.password = password;
  return url.toString();
}

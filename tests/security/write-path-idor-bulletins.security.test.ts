import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseConnection, type DatabaseConnection } from '@playa-post/database';
import { startPostgresTestDatabase, type PostgresTestDatabase } from '@playa-post/testing';

// None of these exist yet — legible failure at this seam until the coder writes them.
import { createArchiveBulletinService } from '../../apps/server/src/modules/bulletins/application/archive-bulletin.service';
import { createCreateBulletinService } from '../../apps/server/src/modules/bulletins/application/create-bulletin.service';
import { createFindVisibleBulletinAuthorQuery } from '../../apps/server/src/modules/bulletins/application/find-visible-bulletin-author.query';
import { createPostgresBulletinRepository } from '../../apps/server/src/modules/bulletins/persistence/postgres-bulletin.repository';
import { createDismissBulletinService } from '../../apps/server/src/modules/moderation/application/dismiss-bulletin.service';
import { createReportBulletinService } from '../../apps/server/src/modules/moderation/application/report-bulletin.service';
import { createUndismissBulletinService } from '../../apps/server/src/modules/moderation/application/undismiss-bulletin.service';
import { ModerationTargetUnavailableError } from '../../apps/server/src/modules/moderation/domain/moderation.errors';
import { createPostgresModerationRepository } from '../../apps/server/src/modules/moderation/persistence/postgres-moderation.repository';
import { createDeleteSavedViewService } from '../../apps/server/src/modules/views/application/delete-saved-view.service';
import { createRenameSavedViewService } from '../../apps/server/src/modules/views/application/rename-saved-view.service';
import { createSaveViewService } from '../../apps/server/src/modules/views/application/save-view.service';
import { createSetSavedViewNotifyService } from '../../apps/server/src/modules/views/application/set-saved-view-notify.service';
import { createUpdateNotifyMeQueryService } from '../../apps/server/src/modules/views/application/update-notify-me-query.service';
import { createPostgresNotifyMeQueryRepository } from '../../apps/server/src/modules/views/persistence/postgres-notify-me-query.repository';
import { createPostgresSavedViewRepository } from '../../apps/server/src/modules/views/persistence/postgres-saved-view.repository';

/**
 * ADR-0002 **B13** — "Write-path IDOR matrix": "For every mutation type in
 * ADR-0005's conflict matrix, an unrelated actor gets a structured failure with zero
 * state change and zero outbox rows."
 *
 * **This is the `bulletin.create` / `bulletin.archive` / `bulletin.undismiss` /
 * `notifyMe.update` subset**,
 * mirroring `visibility-matrix.security.test.ts`'s own precedent for B5: the manifest
 * keeps B13 `live` with this file as `provenBy` because the row cannot be sharded
 * across two states in its schema, with the partial-coverage caveat recorded here
 * rather than in the manifest text (same discipline that file's header comment
 * establishes for B5) — extended by lane L3b-notify to add `notifyMe.update` beside
 * the `bulletin.*` coverage L3a shipped. The full seven-mutation-type matrix
 * (M2-AC19: `bulletin.create`, `bulletin.archive`, `bulletin.report`,
 * `bulletin.dismiss`, `connection.accept`, `trust.set`, `notifyMe.update`) still
 * completes once every M2 lane lands; L5's confirmation pass (m2-lane-briefs.md:789)
 * is the natural place to assert the whole set together, per the AC ambiguity
 * `visibility-matrix.security.test.ts` already recorded for B5. `connection.accept`
 * and `trust.set` remain owed to L4/L5 — `directional-trust.integration.test.ts`
 * proves `trust.set`'s unrelated-actor case at the module level today, the same way
 * `bulletin-request-lifecycle.integration.test.ts` proved `bulletin.archive`'s before
 * this file duplicated it into `tests/security/`.
 *
 * `bulletin.create` has no unrelated-actor case to construct: `CreateBulletinCommand`
 * takes `authorId` only from the resolved `Actor` (never request input, per B14 / the
 * `ViewerId` provenance discipline `shared/auth/viewer-id.ts` documents), so there is
 * no subject for an unrelated actor to be unrelated *to* until the bulletin exists —
 * `bulletin.create` is fail-closed by construction, not by a runtime check this test
 * could exercise. Duplicated from `bulletin-request-lifecycle.integration.test.ts`'s
 * identical scenario.
 *
 * `view.save` is the first row here with a **real** unrelated-actor case rather than a
 * by-construction one: a saved view has an `id` a client legitimately sends
 * (`views.saved.rename` / `.delete` / `.setNotify` all name one), so unlike
 * `notifyMe.update` there genuinely is a field through which actor C can point at user
 * A's row. What makes it fail closed is that every statement behind those procedures
 * carries `owner_id = <actor>` in its `WHERE` — so C's attempt matches nothing, and "it
 * is not yours" and "it does not exist" become the same query result rather than two
 * distinguishable answers (M5-AC16: 404, never 403). That is the property this block
 * exercises, in all three shapes. Duplicated from
 * `modules/views/tests/integration/saved-view.integration.test.ts`'s identical scenario.
 *
 * `notifyMe.update` has the same "fail-closed by construction" shape for a different
 * reason: **the procedure carries no query-identifying field at all**, so there is
 * nothing for an unrelated actor to name — B14 forbids a client-suppliable `ownerId`,
 * and `UpdateNotifyMeQueryCommand` takes `actorId` from the resolved `Actor` only. What
 * makes that addressable was the primary key on `owner_id` (D1, ADR-0007:79) until
 * **decision D16 reopened D1** (#172); the procedure now writes the actor's row whose
 * `source_view_id` is `NULL`, held to one per person by
 * `UNIQUE NULLS NOT DISTINCT (owner_id, source_view_id)`. The property this block
 * exercises is unaffected — an unrelated actor still cannot name a row, whichever
 * constraint is doing the addressing. `update-notify-me-query.service.ts`'s own doc comment
 * states the resulting property: an actor supplying somebody else's
 * `expectedVersion` mismatches their **own** absent row and is refused before a
 * column of anybody else's row is read (`NotifyMeQueryConflictError`, which carries
 * no `currentVersion`/`currentState` — ADR-0005 precedence rule 1's "the conflict
 * envelope is a leak channel" enforced by the error's own shape, not by an
 * application-level redaction step). Duplicated from
 * `notify-me-query.integration.test.ts`'s identical scenario.
 */
describe('B13 — write-path IDOR matrix (bulletin.archive, bulletin.undismiss, notifyMe.update, view.save)', () => {
  let testDatabase: PostgresTestDatabase;
  let database: DatabaseConnection;

  beforeAll(async () => {
    testDatabase = await startPostgresTestDatabase();
    await testDatabase.client.query(`alter role app_rw with password 'app_rw_in_a_throwaway_container'`);
    database = createDatabaseConnection({
      connectionString: asRole(testDatabase.connectionString, 'app_rw', 'app_rw_in_a_throwaway_container'),
    });
  }, 300_000);

  afterEach(async () => {
    await testDatabase.truncateAllTables();
  });

  afterAll(async () => {
    await database?.destroy();
    await testDatabase?.stop();
  });

  async function seedOnboardedUser(handle: string): Promise<string> {
    const { rows } = await testDatabase.client.query<{ id: string }>(
      `insert into app.users (auth_user_id, handle, display_name, created_at)
       values ($1, $2, $3, now()) returning id`,
      [randomUUID(), handle, handle],
    );
    const id = rows[0]?.id;
    if (id === undefined) {
      throw new Error('seedOnboardedUser: insert returned no row');
    }
    return id;
  }

  async function outboxRowCount(): Promise<number> {
    const { rows } = await testDatabase.client.query<{ count: string }>(
      'select count(*)::text as count from app.outbox_events',
    );
    return Number(rows[0]?.count ?? '0');
  }

  async function seedAcceptedConnection(userAId: string, userBId: string): Promise<void> {
    await testDatabase.client.query(
      `insert into app.connections
         (user_a_id, user_b_id, status, a_discloses_to_b_level, b_discloses_to_a_level, created_at)
       values ($1, $2, 'accepted', 'full', 'full', now())`,
      [userAId, userBId],
    );
  }

  async function dismissalRowCount(): Promise<number> {
    const { rows } = await testDatabase.client.query<{ count: string }>(
      'select count(*)::text as count from app.bulletin_dismissals',
    );
    return Number(rows[0]?.count ?? '0');
  }

  async function reportRowCount(): Promise<number> {
    const { rows } = await testDatabase.client.query<{ count: string }>(
      'select count(*)::text as count from app.bulletin_reports',
    );
    return Number(rows[0]?.count ?? '0');
  }

  describe('bulletin.archive', () => {
    it('rejects actor C with zero state change and zero outbox rows', async () => {
      const userA = await seedOnboardedUser('b13_bulletins_a');
      const actorC = await seedOnboardedUser('b13_bulletins_c');

      const bulletins = createPostgresBulletinRepository({ database });
      const createBulletin = createCreateBulletinService({ bulletins });
      const archiveBulletin = createArchiveBulletinService({ bulletins });

      const created = await createBulletin.create({
        authorId: userA,
        type: 'request',
        title: "User A's bulletin",
        body: 'Actor C has no relationship to this at all.',
      });
      const outboxAfterCreate = await outboxRowCount();

      await expect(
        archiveBulletin.archive({ actorId: actorC, bulletinId: created.id }),
      ).rejects.toBeInstanceOf(Error);

      const { rows } = await testDatabase.client.query<{ archived_at: Date | null }>(
        `select archived_at from app.bulletins where id = $1`,
        [created.id],
      );
      expect(rows[0]?.archived_at).toBeNull();
      expect(await outboxRowCount()).toBe(outboxAfterCreate);
    });
  });

  /**
   * `bulletin.undismiss` (#170) — the row this file gains with the Dismissed category.
   *
   * **Two unrelated-actor shapes, because un-dismissing has two of them.** The first is
   * the familiar one: an actor who cannot see the bulletin at all is refused before any
   * statement runs, exactly as `bulletin.dismiss` is. The second is the one that only
   * exists for a *delete*, and it is the one worth the test — an actor who legitimately
   * sees the bulletin, and therefore passes every authorization check, still must not be
   * able to clear somebody else's dismissal. Nothing above the SQL enforces that; the
   * `viewer_id = <actor>` predicate in the delete does, and this is what proves it is
   * still there.
   *
   * A third assertion covers the boundary between the two moderation tables: an
   * un-dismissal must not delete a report. That is not an IDOR, but it is the same class
   * of mistake — a statement reaching a row it was not asked to reach — and the blast
   * radius is a reporter silently losing a filed report (M2-AC10, B9).
   */
  describe('bulletin.undismiss', () => {
    it('rejects an actor who cannot see the bulletin, with zero dismissal rows and zero outbox rows', async () => {
      const userA = await seedOnboardedUser('b13_undismiss_a');
      const actorC = await seedOnboardedUser('b13_undismiss_c');

      const bulletins = createPostgresBulletinRepository({ database });
      const created = await createCreateBulletinService({ bulletins }).create({
        authorId: userA,
        type: 'request',
        title: "User A's bulletin",
        body: 'Actor C has no relationship to this at all.',
      });
      const outboxAfterCreate = await outboxRowCount();

      await expect(
        createUndismissBulletinService({
          moderation: createPostgresModerationRepository({ database }),
          findVisibleBulletin: createFindVisibleBulletinAuthorQuery({ bulletins }),
        }).undismiss({ actorId: actorC, bulletinId: created.id }),
        // The specific refusal, not any Error — a wiring or database failure would also
        // reject, and this row is only proven if the *authorization* check is what fired.
      ).rejects.toBeInstanceOf(ModerationTargetUnavailableError);

      expect(await dismissalRowCount()).toBe(0);
      expect(await outboxRowCount()).toBe(outboxAfterCreate);
    });

    it("leaves another viewer's dismissal in place, and never touches a report", async () => {
      const userA = await seedOnboardedUser('b13_undismiss_owner_a');
      const viewerV = await seedOnboardedUser('b13_undismiss_owner_v');
      const viewerW = await seedOnboardedUser('b13_undismiss_owner_w');
      await seedAcceptedConnection(userA, viewerV);
      await seedAcceptedConnection(userA, viewerW);

      const bulletins = createPostgresBulletinRepository({ database });
      const moderation = createPostgresModerationRepository({ database });
      const findVisibleBulletin = createFindVisibleBulletinAuthorQuery({ bulletins });

      const created = await createCreateBulletinService({ bulletins }).create({
        authorId: userA,
        type: 'request',
        title: "User A's bulletin",
        body: 'V dismisses and reports it; W tries to undo that.',
      });

      await createDismissBulletinService({ moderation, findVisibleBulletin }).dismiss({
        actorId: viewerV,
        bulletinId: created.id,
      });
      await createReportBulletinService({ moderation, findVisibleBulletin }).report({
        actorId: viewerV,
        bulletinId: created.id,
        reason: 'spam',
        detail: 'V filed this and it must survive.',
      });
      const outboxAfterSetup = await outboxRowCount();

      // W is an eligible viewer, so this is *not* refused — it succeeds and does nothing,
      // which is the honest outcome: W had no dismissal to withdraw. The property under
      // test is that a successful call still cannot reach V's row.
      await createUndismissBulletinService({ moderation, findVisibleBulletin }).undismiss({
        actorId: viewerW,
        bulletinId: created.id,
      });

      const { rows: dismissals } = await testDatabase.client.query<{ viewer_id: string }>(
        'select viewer_id from app.bulletin_dismissals where bulletin_id = $1',
        [created.id],
      );
      expect(dismissals.map((row) => row.viewer_id)).toEqual([viewerV]);

      // The report is a different table and a different decision. Un-dismissing withdraws
      // "not for me"; it must never withdraw "this is unwanted content".
      expect(await reportRowCount()).toBe(1);
      expect(await outboxRowCount()).toBe(outboxAfterSetup);
    });
  });

  describe('notifyMe.update', () => {
    async function seedNotifyMeQuery(
      ownerId: string,
      options: { readonly sourceText: string; readonly version: number },
    ): Promise<void> {
      await testDatabase.client.query(
        `insert into app.notify_me_queries (owner_id, source_text, ast, ast_version, version, updated_at)
         values ($1, $2, $3::jsonb, 1, $4, now())`,
        [ownerId, options.sourceText, JSON.stringify({ types: ['request'], text: [] }), options.version],
      );
    }

    async function queryRowFor(
      ownerId: string,
    ): Promise<{ source_text: string; version: number } | undefined> {
      const { rows } = await testDatabase.client.query<{ source_text: string; version: number }>(
        `select source_text, version from app.notify_me_queries where owner_id = $1`,
        [ownerId],
      );
      return rows[0];
    }

    it(
      "rejects actor C with zero state change on user A's row, zero outbox rows, and no " +
        "conflict-envelope leak of A's state",
      async () => {
        const userA = await seedOnboardedUser('b13_notifyme_a');
        const actorC = await seedOnboardedUser('b13_notifyme_c');

        // A has a saved query. C has no relationship to A or to A's query — there is
        // no `connections` row between them, and there is no field on the mutation
        // through which C could name A's query at all (D1, B14). C's only possible
        // attack is guessing/observing A's `expectedVersion` and submitting it as
        // their own, hoping it is treated as a match against somebody else's row.
        await seedNotifyMeQuery(userA, { sourceText: 'type:request tag:kitchen', version: 3 });
        const outboxBeforeUpdate = await outboxRowCount();

        const notifyMeQueries = createPostgresNotifyMeQueryRepository({ database });
        const updateNotifyMeQuery = createUpdateNotifyMeQueryService({ notifyMeQueries });

        const rejection = await updateNotifyMeQuery
          .update({ actorId: actorC, sourceText: 'type:request', expectedVersion: 3 })
          .catch((error: unknown) => error);

        expect(rejection).toBeInstanceOf(Error);

        // ADR-0005: "the conflict envelope is a leak channel" — C's rejection must
        // not carry A's saved query text, and must carry no version/state field at
        // all (NotifyMeQueryConflictError's own contract).
        const serialized = JSON.stringify(rejection, Object.getOwnPropertyNames(rejection as object));
        expect(serialized).not.toMatch(/kitchen/);
        expect(serialized).not.toMatch(/currentState/);
        expect(serialized).not.toMatch(/currentVersion/);

        expect(await queryRowFor(userA)).toEqual({ source_text: 'type:request tag:kitchen', version: 3 });
        expect(await queryRowFor(actorC)).toBeUndefined();
        expect(await outboxRowCount()).toBe(outboxBeforeUpdate);
      },
    );
  });

  describe('view.save', () => {
    it("rejects actor C on rename, delete and setNotify with zero state change on user A's view", async () => {
      const userA = await seedOnboardedUser('b13_savedviews_a');
      const actorC = await seedOnboardedUser('b13_savedviews_c');

      const savedViews = createPostgresSavedViewRepository({ database });
      const saveView = createSaveViewService({ savedViews });
      const renameSavedView = createRenameSavedViewService({ savedViews });
      const deleteSavedView = createDeleteSavedViewService({ savedViews });
      const setSavedViewNotify = createSetSavedViewNotifyService({ savedViews });

      // A saves a view and lights its bell, so there is state on BOTH tables for C to
      // reach — the designation is the part a `notify boolean` on someone else's row
      // would have made writable (ADR-0016).
      const viewA = await saveView.save({
        actorId: userA,
        name: 'Kitchen crew',
        sourceText: 'type:request kitchen',
      });
      await setSavedViewNotify.set({ actorId: userA, viewId: viewA.id, notify: true });
      const outboxBeforeAttack = await outboxRowCount();

      // C has no relationship to A and no view of their own. Unlike notifyMe.update,
      // C CAN name A's row — `viewId` is a legitimate client-supplied field — so this
      // is a real attempt rather than a structurally impossible one.
      const renameRejection = await renameSavedView
        .rename({ actorId: actorC, viewId: viewA.id, name: 'Mine now', expectedVersion: 1 })
        .catch((error: unknown) => error);
      expect(renameRejection).toBeInstanceOf(Error);

      const notifyRejection = await setSavedViewNotify
        .set({ actorId: actorC, viewId: viewA.id, notify: false })
        .catch((error: unknown) => error);
      expect(notifyRejection).toBeInstanceOf(Error);

      // Delete answers `deleted: false` rather than throwing — the same answer an
      // invented id gets, which is what stops it being an oracle for real view ids.
      await expect(deleteSavedView.delete({ actorId: actorC, viewId: viewA.id })).resolves.toEqual(
        { viewId: viewA.id, deleted: false },
      );

      for (const rejection of [renameRejection, notifyRejection]) {
        const serialized = JSON.stringify(rejection, Object.getOwnPropertyNames(rejection as object));
        // ADR-0005's "the conflict envelope is a leak channel", applied to a view: C's
        // refusals must carry neither A's name, nor A's query text, nor any version.
        expect(serialized).not.toMatch(/[Kk]itchen/);
        expect(serialized).not.toMatch(/currentState/);
        expect(serialized).not.toMatch(/currentVersion/);
      }

      const { rows: viewRows } = await testDatabase.client.query<{
        owner_id: string;
        name: string;
      }>(`select owner_id, name from app.saved_views`);
      expect(viewRows).toEqual([{ owner_id: userA, name: 'Kitchen crew' }]);

      // A's bell is still lit, on A's view, and C never acquired one.
      const { rows: designationRows } = await testDatabase.client.query<{
        owner_id: string;
        source_view_id: string | null;
      }>(`select owner_id, source_view_id from app.notify_me_queries`);
      expect(designationRows).toEqual([{ owner_id: userA, source_view_id: viewA.id }]);

      expect(await outboxRowCount()).toBe(outboxBeforeAttack);
    });
  });
});

/** Mirrors `packages/database/src/database-schema.integration.test.ts`'s helper. */
function asRole(connectionString: string, username: string, password: string): string {
  const url = new URL(connectionString);
  url.username = username;
  url.password = password;
  return url.toString();
}

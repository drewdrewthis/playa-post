import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseConnection, type DatabaseConnection } from '@playa-post/database';
import { startPostgresTestDatabase, type PostgresTestDatabase } from '@playa-post/testing';

import { createDeleteSavedViewService } from '../../application/delete-saved-view.service';
import { createListSavedViewsQuery } from '../../application/list-saved-views.query';
import { createRenameSavedViewService } from '../../application/rename-saved-view.service';
import { createSaveViewService } from '../../application/save-view.service';
import { createSetSavedViewNotifyService } from '../../application/set-saved-view-notify.service';
import { createUpdateNotifyMeQueryService } from '../../application/update-notify-me-query.service';
import { InvalidBoardQueryError } from '../../domain/board-query-grammar';
import { SAVED_VIEW_LIMIT_PER_OWNER } from '../../domain/saved-view';
import {
  SavedViewConflictError,
  SavedViewLimitReachedError,
  SavedViewUnavailableError,
} from '../../domain/saved-view.errors';
import { createPostgresNotifyMeQueryRepository } from '../../persistence/postgres-notify-me-query.repository';
import { createPostgresSavedViewRepository } from '../../persistence/postgres-saved-view.repository';

/**
 * Saved views end to end against real Postgres (issue #45, ADR-0007:77, ADR-0016).
 *
 * Three things are being proved here, and only the first is CRUD:
 *
 * 1. **The screen's operations work** — save, list, rename, delete.
 * 2. **M5-AC16 holds by construction.** Every statement is scoped
 *    `WHERE owner_id = <actor>`, so an actor naming somebody else's view id gets the
 *    same answer an invented id gets. Asserted as *both* halves: the other owner's row
 *    is untouched, and the refusal carries none of their state.
 * 3. **Decision D1 survives a per-view bell.** The comp draws a bell on every card and
 *    the PDF allows exactly one Notify Me query; D1 resolved that by making the bell a
 *    *designation*. The assertion that matters is that `app.notify_me_queries` never
 *    holds two rows for one owner no matter how many bells get tapped — which is its
 *    primary key, not a rule this code enforces.
 */
describe('saved views (issue #45, M5-AC16, D1)', () => {
  let testDatabase: PostgresTestDatabase;
  let database: DatabaseConnection;

  beforeAll(async () => {
    testDatabase = await startPostgresTestDatabase();
    await testDatabase.client.query(
      `alter role app_rw with password 'app_rw_in_a_throwaway_container'`,
    );
    database = createDatabaseConnection({
      connectionString: asRole(
        testDatabase.connectionString,
        'app_rw',
        'app_rw_in_a_throwaway_container',
      ),
    });
  }, 300_000);

  afterEach(async () => {
    await testDatabase.truncateAllTables();
  });

  afterAll(async () => {
    await database?.destroy();
    await testDatabase?.stop();
  });

  function services(): {
    save: ReturnType<typeof createSaveViewService>;
    list: ReturnType<typeof createListSavedViewsQuery>;
    rename: ReturnType<typeof createRenameSavedViewService>;
    remove: ReturnType<typeof createDeleteSavedViewService>;
    setNotify: ReturnType<typeof createSetSavedViewNotifyService>;
    updateNotifyMe: ReturnType<typeof createUpdateNotifyMeQueryService>;
  } {
    const savedViews = createPostgresSavedViewRepository({ database });
    const notifyMeQueries = createPostgresNotifyMeQueryRepository({ database });

    return {
      save: createSaveViewService({ savedViews }),
      list: createListSavedViewsQuery({ savedViews }),
      rename: createRenameSavedViewService({ savedViews }),
      remove: createDeleteSavedViewService({ savedViews }),
      setNotify: createSetSavedViewNotifyService({ savedViews }),
      updateNotifyMe: createUpdateNotifyMeQueryService({ notifyMeQueries }),
    };
  }

  async function seedOnboardedUser(handle: string): Promise<string> {
    const { rows } = await testDatabase.client.query<{ id: string }>(
      `insert into app.users (auth_user_id, handle, display_name, created_at)
       values ($1, $2, $3, now()) returning id`,
      [randomUUID(), handle, handle],
    );
    const userId = rows[0]?.id;
    if (userId === undefined) {
      throw new Error('seedOnboardedUser: insert returned no row');
    }
    return userId;
  }

  async function notifyMeRows(): Promise<
    readonly { owner_id: string; source_text: string; source_view_id: string | null; version: number }[]
  > {
    const { rows } = await testDatabase.client.query<{
      owner_id: string;
      source_text: string;
      source_view_id: string | null;
      version: number;
    }>(`select owner_id, source_text, source_view_id, version from app.notify_me_queries`);
    return rows;
  }

  async function outboxEventTypes(): Promise<readonly string[]> {
    const { rows } = await testDatabase.client.query<{ event_type: string }>(
      `select event_type from app.outbox_events order by occurred_at, event_type`,
    );
    return rows.map((row) => row.event_type);
  }

  async function savedViewRows(): Promise<readonly { id: string; owner_id: string; name: string }[]> {
    const { rows } = await testDatabase.client.query<{
      id: string;
      owner_id: string;
      name: string;
    }>(`select id, owner_id, name from app.saved_views order by created_at, id`);
    return rows;
  }

  describe('save, list, rename, delete', () => {
    it('stores a view and lists it back with no bell lit', async () => {
      const owner = await seedOnboardedUser('dusty_views_save');
      const { save, list } = services();

      const view = await save.save({
        actorId: owner,
        name: '  Rides to BRC  ',
        sourceText: 'type:offer truck',
      });

      expect(view.name).toBe('Rides to BRC');
      expect(view.sourceText).toBe('type:offer truck');
      expect(view.version).toBe(1);

      const listing = await list.list({ viewerId: owner });
      expect(listing.views.map((each) => each.id)).toEqual([view.id]);
      expect(listing.notifyingViewId).toBeNull();
    });

    it('parses the query through the one grammar and stores nothing when it is refused', async () => {
      const owner = await seedOnboardedUser('dusty_views_grammar');
      const { save, list } = services();

      // `from:` is M5's, deliberately still refused (ADR-0007:53-56). A query the board
      // will not run must not become a view claiming to run it.
      await expect(
        save.save({ actorId: owner, name: 'Moss offers', sourceText: 'from:moss' }),
      ).rejects.toBeInstanceOf(InvalidBoardQueryError);

      expect((await list.list({ viewerId: owner })).views).toHaveLength(0);
    });

    it('lists views oldest first, so a card does not move under a thumb', async () => {
      const owner = await seedOnboardedUser('dusty_views_order');
      const savedViews = createPostgresSavedViewRepository({ database });
      const save = createSaveViewService({ savedViews });

      const first = await save.save({ actorId: owner, name: 'First', sourceText: 'type:request' });
      const second = await save.save({ actorId: owner, name: 'Second', sourceText: 'type:event' });

      const listing = await createListSavedViewsQuery({ savedViews }).list({ viewerId: owner });
      expect(listing.views.map((each) => each.name)).toEqual(['First', 'Second']);
      expect(listing.views.map((each) => each.id)).toEqual([first.id, second.id]);
    });

    it('renames on a matching version and bumps it; refuses a stale one without touching the row', async () => {
      const owner = await seedOnboardedUser('dusty_views_rename');
      const { save, rename, list } = services();

      const view = await save.save({ actorId: owner, name: 'Old', sourceText: 'type:request' });

      const renamed = await rename.rename({
        actorId: owner,
        viewId: view.id,
        name: 'New',
        expectedVersion: view.version,
      });
      expect(renamed.name).toBe('New');
      expect(renamed.version).toBe(view.version + 1);
      // The query is untouched: a rename that could re-point a card at different results
      // is the one edit that would make a saved view untrustworthy.
      expect(renamed.sourceText).toBe('type:request');

      await expect(
        rename.rename({
          actorId: owner,
          viewId: view.id,
          name: 'Stale',
          expectedVersion: view.version,
        }),
      ).rejects.toBeInstanceOf(SavedViewConflictError);

      expect((await list.list({ viewerId: owner })).views[0]?.name).toBe('New');
    });

    it('deletes idempotently — the second call succeeds and reports that nothing was removed', async () => {
      const owner = await seedOnboardedUser('dusty_views_delete');
      const { save, remove, list } = services();

      const view = await save.save({ actorId: owner, name: 'Gone soon', sourceText: 'type:request' });

      await expect(remove.delete({ actorId: owner, viewId: view.id })).resolves.toEqual({
        viewId: view.id,
        deleted: true,
      });
      await expect(remove.delete({ actorId: owner, viewId: view.id })).resolves.toEqual({
        viewId: view.id,
        deleted: false,
      });

      expect((await list.list({ viewerId: owner })).views).toHaveLength(0);
    });

    it(`refuses the ${String(SAVED_VIEW_LIMIT_PER_OWNER + 1)}th view rather than growing without bound`, async () => {
      const owner = await seedOnboardedUser('dusty_views_limit');
      const { save } = services();

      for (let index = 0; index < SAVED_VIEW_LIMIT_PER_OWNER; index += 1) {
        // Sequential on purpose: the cap is counted per transaction, so firing these
        // concurrently would be testing the race rather than the bound.
        await save.save({
          actorId: owner,
          name: `View ${String(index)}`,
          sourceText: 'type:request',
        });
      }

      await expect(
        save.save({ actorId: owner, name: 'One too many', sourceText: 'type:request' }),
      ).rejects.toBeInstanceOf(SavedViewLimitReachedError);
    });
  });

  describe('Scenario: a saved view is reachable only by its owner (M5-AC16, ADR-0002 B13 `view.save`)', () => {
    it("leaves owner A's view untouched, writes no outbox row, and leaks nothing of A's state", async () => {
      const ownerA = await seedOnboardedUser('dusty_views_owner_a');
      const actorC = await seedOnboardedUser('dusty_views_actor_c');
      const { save, rename, remove, setNotify, list } = services();

      const viewA = await save.save({
        actorId: ownerA,
        name: 'Kitchen crew',
        sourceText: 'type:request kitchen',
      });

      // C has no views of their own and reaches for A's the only way the API allows: by
      // naming its id. Each operation must answer as though the id were invented.
      const renameRejection = await rename
        .rename({ actorId: actorC, viewId: viewA.id, name: 'Mine now', expectedVersion: 1 })
        .catch((error: unknown) => error);
      expect(renameRejection).toBeInstanceOf(SavedViewConflictError);

      const notifyRejection = await setNotify
        .set({ actorId: actorC, viewId: viewA.id, notify: true })
        .catch((error: unknown) => error);
      expect(notifyRejection).toBeInstanceOf(SavedViewUnavailableError);

      // Both directions of the switch, because one procedure with two not-found
      // semantics is a seam a later edit gets wrong — see the repository's own note.
      await expect(
        setNotify.set({ actorId: actorC, viewId: viewA.id, notify: false }),
      ).rejects.toBeInstanceOf(SavedViewUnavailableError);

      await expect(remove.delete({ actorId: actorC, viewId: viewA.id })).resolves.toEqual({
        viewId: viewA.id,
        deleted: false,
      });

      for (const rejection of [renameRejection, notifyRejection]) {
        const serialized = JSON.stringify(
          rejection,
          Object.getOwnPropertyNames(rejection as object),
        );
        // A conflict envelope is a leak channel (ADR-0005): C's refusal must not carry
        // A's name or the query text behind it.
        expect(serialized).not.toMatch(/[Kk]itchen/);
      }

      expect(await savedViewRows()).toEqual([
        { id: viewA.id, owner_id: ownerA, name: 'Kitchen crew' },
      ]);
      expect((await list.list({ viewerId: actorC })).views).toHaveLength(0);
      expect(await notifyMeRows()).toHaveLength(0);
      expect(await outboxEventTypes()).toHaveLength(0);
    });
  });

  describe('Scenario: the bell designates one view, and moving it does not create a second query (D1)', () => {
    it('writes exactly one notify_me_queries row however many bells are tapped', async () => {
      const owner = await seedOnboardedUser('dusty_views_bell');
      const { save, setNotify, list } = services();

      const rides = await save.save({
        actorId: owner,
        name: 'Rides',
        sourceText: 'type:offer truck',
      });
      const events = await save.save({ actorId: owner, name: 'Events', sourceText: 'type:event' });

      await expect(
        setNotify.set({ actorId: owner, viewId: rides.id, notify: true }),
      ).resolves.toEqual({ notifyingViewId: rides.id });

      expect(await notifyMeRows()).toEqual([
        {
          owner_id: owner,
          source_text: 'type:offer truck',
          source_view_id: rides.id,
          version: 1,
        },
      ]);

      // D1: "toggling a bell on view B moves Notify Me from view A, it does not create a
      // second notifying query."
      await expect(
        setNotify.set({ actorId: owner, viewId: events.id, notify: true }),
      ).resolves.toEqual({ notifyingViewId: events.id });

      expect(await notifyMeRows()).toEqual([
        {
          owner_id: owner,
          source_text: 'type:event',
          source_view_id: events.id,
          // Bumped, so a client holding a stale expectedVersion cannot overwrite a
          // designation it never saw (ADR-0005:98).
          version: 2,
        },
      ]);

      expect((await list.list({ viewerId: owner })).notifyingViewId).toBe(events.id);
      expect(await outboxEventTypes()).toEqual(['NotifyMeQueryChanged', 'NotifyMeQueryChanged']);
    });

    it('clears the query when the bell is switched off, and says so on the outbox', async () => {
      const owner = await seedOnboardedUser('dusty_views_bell_off');
      const { save, setNotify, list } = services();

      const view = await save.save({ actorId: owner, name: 'Rides', sourceText: 'type:offer' });
      await setNotify.set({ actorId: owner, viewId: view.id, notify: true });

      await expect(
        setNotify.set({ actorId: owner, viewId: view.id, notify: false }),
      ).resolves.toEqual({ notifyingViewId: null });

      expect(await notifyMeRows()).toHaveLength(0);
      expect((await list.list({ viewerId: owner })).notifyingViewId).toBeNull();
      expect(await outboxEventTypes()).toEqual(['NotifyMeQueryChanged', 'NotifyMeQueryCleared']);
    });

    it('does not switch off a bell that has already moved — a stale client must not undo a live choice', async () => {
      const owner = await seedOnboardedUser('dusty_views_bell_stale');
      const { save, setNotify } = services();

      const rides = await save.save({ actorId: owner, name: 'Rides', sourceText: 'type:offer' });
      const events = await save.save({ actorId: owner, name: 'Events', sourceText: 'type:event' });

      await setNotify.set({ actorId: owner, viewId: rides.id, notify: true });
      await setNotify.set({ actorId: owner, viewId: events.id, notify: true });

      // A client that still believes the bell is on `rides` taps it off.
      await expect(
        setNotify.set({ actorId: owner, viewId: rides.id, notify: false }),
      ).resolves.toEqual({ notifyingViewId: events.id });

      expect(await notifyMeRows()).toHaveLength(1);
    });

    it('stops the notifications when the view the bell is on is deleted', async () => {
      const owner = await seedOnboardedUser('dusty_views_bell_deleted');
      const { save, setNotify, remove } = services();

      const view = await save.save({ actorId: owner, name: 'Rides', sourceText: 'type:offer' });
      await setNotify.set({ actorId: owner, viewId: view.id, notify: true });

      await expect(remove.delete({ actorId: owner, viewId: view.id })).resolves.toEqual({
        viewId: view.id,
        deleted: true,
      });

      // The bell that turned them on was on the card that just disappeared; leaving the
      // query would push notifications with no surface left to switch them off.
      expect(await notifyMeRows()).toHaveLength(0);
      expect(await savedViewRows()).toHaveLength(0);
      expect(await outboxEventTypes()).toEqual(['NotifyMeQueryChanged', 'NotifyMeQueryCleared']);
    });

    it('leaves the designation clear when views.notifyMe.update writes a query of its own', async () => {
      const owner = await seedOnboardedUser('dusty_views_notify_direct');
      const { save, setNotify, updateNotifyMe, list } = services();

      const view = await save.save({ actorId: owner, name: 'Rides', sourceText: 'type:offer' });
      await setNotify.set({ actorId: owner, viewId: view.id, notify: true });

      // The pre-existing procedure still works, and takes the query away from the view:
      // the text is no longer what the card says, so no card's bell may stay lit.
      await updateNotifyMe.update({
        actorId: owner,
        sourceText: 'type:request',
        expectedVersion: 1,
      });

      expect(await notifyMeRows()).toEqual([
        { owner_id: owner, source_text: 'type:request', source_view_id: null, version: 2 },
      ]);
      expect((await list.list({ viewerId: owner })).notifyingViewId).toBeNull();
    });
  });

  /**
   * Scenario: the *designation* is owner-scoped too, not just the views (M5-AC16).
   *
   * The M5-AC16 block above proves the `app.saved_views` statements are scoped — an
   * actor listing sees none of another owner's rows, and rename/delete/setNotify all
   * refuse. It cannot say anything about the four statements that read or write
   * `app.notify_me_queries`, because **no owner in it has a bell lit**: with that table
   * empty, `listFor`'s second query, `currentDesignation`, and the clear inside `delete`
   * all return or affect nothing whether their `owner_id` predicate is there or not.
   * Correct today, and unpinned — which is how a predicate gets deleted in a later
   * refactor with a green suite.
   *
   * ⚠ **Nothing behind these statements is a second line of defence.** ADR-0002 §4's
   * policy is `using (true) with check (true)` on purpose — "viewer-scoped authorization
   * lives in the application layer" — so `app_rw` reads every row of
   * `app.notify_me_queries` regardless of who is asking. The `owner_id` predicate in the
   * statement is the whole control.
   *
   * Each test below was written by falsification: the predicate it names was actually
   * deleted, the test observed red, and the predicate restored. Two of them are
   * constructed so that no query-plan detail can let them pass — see their comments.
   */
  describe("Scenario: another owner's Notify Me designation is invisible (M5-AC16)", () => {
    it("does not report another owner's designated view as the caller's lit bell", async () => {
      const ownerA = await seedOnboardedUser('dusty_designation_owner_a');
      const ownerB = await seedOnboardedUser('dusty_designation_owner_b');
      const { save, setNotify, list } = services();

      const viewA = await save.save({
        actorId: ownerA,
        name: 'Kitchen crew',
        sourceText: 'type:request kitchen',
      });
      await setNotify.set({ actorId: ownerA, viewId: viewA.id, notify: true });

      const viewB = await save.save({
        actorId: ownerB,
        name: 'B events',
        sourceText: 'type:event',
      });

      // B has no bell lit and A's is the only row in the table, so an unscoped read of
      // `app.notify_me_queries` can only return A's — handing B a UUID naming one of A's
      // saved views, in the field B's client renders as "your notifications are on".
      // Deterministic: one row means `executeTakeFirst` has nothing else to pick.
      const listing = await list.list({ viewerId: ownerB });

      expect(listing.notifyingViewId).toBeNull();
      expect(listing.views.map((each) => each.id)).toEqual([viewB.id]);
    });

    it('reports each owner the bell on their own view when both have one lit', async () => {
      const ownerA = await seedOnboardedUser('dusty_designation_both_a');
      const ownerB = await seedOnboardedUser('dusty_designation_both_b');
      const { save, setNotify, list } = services();

      const viewA = await save.save({ actorId: ownerA, name: 'A rides', sourceText: 'type:offer' });
      const viewB = await save.save({ actorId: ownerB, name: 'B events', sourceText: 'type:event' });

      await setNotify.set({ actorId: ownerA, viewId: viewA.id, notify: true });
      await setNotify.set({ actorId: ownerB, viewId: viewB.id, notify: true });

      // Both assertions in one test on purpose. Unscoped, `executeTakeFirst` returns
      // whichever of the two rows the plan emits first — and that single row can be the
      // right answer for at most ONE of these owners, so one of the two must fail
      // whichever way the planner goes. No storage or plan detail can make this pass
      // without the predicate.
      expect((await list.list({ viewerId: ownerA })).notifyingViewId).toBe(viewA.id);
      expect((await list.list({ viewerId: ownerB })).notifyingViewId).toBe(viewB.id);
    });

    it("answers a no-op bell-off with the caller's own designation, never another owner's", async () => {
      const ownerA = await seedOnboardedUser('dusty_designation_noop_a');
      const ownerB = await seedOnboardedUser('dusty_designation_noop_b');
      const { save, setNotify } = services();

      const viewA = await save.save({ actorId: ownerA, name: 'A rides', sourceText: 'type:offer' });
      await setNotify.set({ actorId: ownerA, viewId: viewA.id, notify: true });

      const viewB = await save.save({ actorId: ownerB, name: 'B events', sourceText: 'type:event' });

      // B taps off a bell that was never on. Nothing of B's matches the clear, so the
      // repository falls through to `currentDesignation` — "where is my bell actually?",
      // the one read on that path and the only statement in this file no other test
      // reaches while `app.notify_me_queries` holds a row. Unscoped it answers with A's.
      await expect(
        setNotify.set({ actorId: ownerB, viewId: viewB.id, notify: false }),
      ).resolves.toEqual({ notifyingViewId: null });

      // A's bell is untouched by B's tap.
      expect(await notifyMeRows()).toEqual([
        {
          owner_id: ownerA,
          source_text: 'type:offer',
          source_view_id: viewA.id,
          version: 1,
        },
      ]);
    });

    it("does not switch off another owner's notifications when a stranger deletes their view by id", async () => {
      const ownerA = await seedOnboardedUser('dusty_designation_delete_a');
      const actorC = await seedOnboardedUser('dusty_designation_delete_c');
      const { save, setNotify, remove } = services();

      const viewA = await save.save({ actorId: ownerA, name: 'A rides', sourceText: 'type:offer' });
      await setNotify.set({ actorId: ownerA, viewId: viewA.id, notify: true });

      await expect(remove.delete({ actorId: actorC, viewId: viewA.id })).resolves.toEqual({
        viewId: viewA.id,
        deleted: false,
      });

      // `delete` clears the designation *before* removing the row, because the FK refuses
      // the delete while a designation still points there. Scoped to the actor that clear
      // matches nothing here; unscoped it matches on `source_view_id` alone — so C, who
      // cannot delete the view and does not, silently switches A's notifications off and
      // lands a `NotifyMeQueryCleared` attributed to C.
      expect(await notifyMeRows()).toEqual([
        {
          owner_id: ownerA,
          source_text: 'type:offer',
          source_view_id: viewA.id,
          version: 1,
        },
      ]);
      expect(await outboxEventTypes()).toEqual(['NotifyMeQueryChanged']);
      expect(await savedViewRows()).toEqual([
        { id: viewA.id, owner_id: ownerA, name: 'A rides' },
      ]);
    });

    it("counts only the caller's own views against the per-owner cap", async () => {
      const ownerA = await seedOnboardedUser('dusty_designation_cap_a');
      const ownerB = await seedOnboardedUser('dusty_designation_cap_b');
      const { save, list } = services();

      for (let index = 0; index < SAVED_VIEW_LIMIT_PER_OWNER; index += 1) {
        // Sequential for the same reason the cap test above is: firing these concurrently
        // would be testing the race rather than the bound.
        await save.save({
          actorId: ownerA,
          name: `A view ${String(index)}`,
          sourceText: 'type:request',
        });
      }

      // B keeps nothing, so B's first save must land. An unscoped count sees A's full
      // list and refuses it — one person filling their own Saved screen would lock every
      // other person out of saving anything. A cap is per owner or it is a shared
      // resource, and this is the only assertion that can tell the two apart.
      const viewB = await save.save({
        actorId: ownerB,
        name: 'B first',
        sourceText: 'type:event',
      });

      expect(viewB.ownerId).toBe(ownerB);
      expect((await list.list({ viewerId: ownerB })).views.map((each) => each.id)).toEqual([
        viewB.id,
      ]);
    });

    it("refuses a designation pointing at another owner's view, in the database", async () => {
      const ownerA = await seedOnboardedUser('dusty_designation_fkey_a');
      const ownerB = await seedOnboardedUser('dusty_designation_fkey_b');
      const { save } = services();

      const viewA = await save.save({ actorId: ownerA, name: 'A rides', sourceText: 'type:offer' });

      // ⚠ Asserted against raw SQL rather than through a service **because no service can
      // reach this state**, and that is the finding rather than a gap. `setNotify`'s clear
      // is the one statement in the repository whose `owner_id` predicate cannot be made
      // to matter by any test: deleting it leaves this whole file green, because
      // `notify_me_queries_source_view_fkey` is COMPOSITE on
      // `(owner_id, source_view_id) references app.saved_views (owner_id, id)` and there
      // is no row it would have to exclude. That redundancy is only real while the
      // constraint is — so the constraint is what gets pinned, and the predicate stays as
      // defence in depth rather than being deleted on the strength of it.
      await expect(
        testDatabase.client.query(
          `insert into app.notify_me_queries
             (owner_id, source_text, ast, ast_version, updated_at, source_view_id)
           values ($1, 'type:offer', $2, 1, now(), $3)`,
          [ownerB, JSON.stringify({ types: ['offer'], text: [] }), viewA.id],
        ),
      ).rejects.toThrow(/notify_me_queries_source_view_fkey/);

      expect(await notifyMeRows()).toHaveLength(0);
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

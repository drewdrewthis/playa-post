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
import { NOTIFY_ME_QUERY_LIMIT_PER_OWNER } from '../../domain/notify-me-query';
import {
  NotifyMeQueryConflictError,
  NotifyMeQueryLimitReachedError,
} from '../../domain/notify-me-query.errors';
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
 * 3. **Decision D16 — every bell is its own switch.** D1 read the PDF's one Notify Me
 *    query against the comp's bell-per-card and made the bell a *designation*: exactly one
 *    row per owner, moved rather than added. **Issue #172 reopened that**, and what these
 *    tests now hold down is the pair of claims that replaced it — several bells may be lit
 *    at once, and switching one changes nothing about the others. The invariant is
 *    `(owner_id, source_view_id)` unique, not `owner_id` unique, so the assertions look for
 *    one row *per bell* rather than one row per person.
 */
describe('saved views (issue #45, #172, M5-AC16, D16)', () => {
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
      expect(listing.notifyingViewIds).toEqual([]);
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

    it('renames only the view it was given, not every view of that owner sharing its version', async () => {
      // ⚠ This test exists to pin `rename`'s `.where('id', ...)` predicate, which every
      // other rename assertion leaves free: they run against an owner holding a single
      // view, where `WHERE owner_id = X AND version = N` and `WHERE id = V AND
      // owner_id = X AND version = N` select the identical row. Views that have never
      // been renamed all sit at `version = 1`, so an unscoped UPDATE would rename the
      // owner's whole shelf the first time they rename anything — and
      // `returningAll().executeTakeFirst()` would still hand back one row, so the API
      // response looks correct while N rows were mutated.
      const owner = await seedOnboardedUser('dusty_views_rename_scope');
      const { save, rename, list } = services();

      const rides = await save.save({ actorId: owner, name: 'Rides', sourceText: 'type:offer' });
      const events = await save.save({ actorId: owner, name: 'Events', sourceText: 'type:event' });
      expect(rides.version).toBe(events.version);

      await rename.rename({
        actorId: owner,
        viewId: rides.id,
        name: 'Rides to BRC',
        expectedVersion: rides.version,
      });

      const listing = await list.list({ viewerId: owner });
      expect(listing.views.map((each) => [each.id, each.name, each.version])).toEqual([
        [rides.id, 'Rides to BRC', rides.version + 1],
        [events.id, 'Events', events.version],
      ]);
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

    it('deletes only the view it was given, leaving the owner’s other views standing', async () => {
      // ⚠ Pins `delete`'s `.where('id', ...)` predicate, and deliberately with **no bell
      // lit anywhere**. Every other delete assertion runs against an owner holding one
      // view, where dropping that predicate selects the identical row. Unscoped, this
      // becomes "delete all my views" while `numDeletedRows > 0n` still reports success
      // — silent, total, unrecoverable loss.
      //
      // The no-bell shape is the point: with a designation lit on another view,
      // `notify_me_queries_source_view_fkey` aborts the transaction and the predicate
      // would look pinned when it is only being masked by the FK. Nothing catches it
      // here but the assertion below.
      const owner = await seedOnboardedUser('dusty_views_delete_scope');
      const { save, remove, list } = services();

      const rides = await save.save({ actorId: owner, name: 'Rides', sourceText: 'type:offer' });
      const events = await save.save({ actorId: owner, name: 'Events', sourceText: 'type:event' });

      await expect(remove.delete({ actorId: owner, viewId: rides.id })).resolves.toEqual({
        viewId: rides.id,
        deleted: true,
      });

      const listing = await list.list({ viewerId: owner });
      expect(listing.views.map((each) => [each.id, each.name])).toEqual([[events.id, 'Events']]);
    });

    it('leaves a bell lit on another view alone when a different view is deleted', async () => {
      // ⚠ Pins `delete`'s notify-clear `.where('source_view_id', ...)` predicate. The
      // identical pair in `setNotify` is pinned by the stale-client test; this copy had
      // no equivalent, because every scenario reaching it had the bell on the view being
      // deleted, no bell at all, or a stranger acting — and in all three, dropping the
      // predicate selects the same rows.
      //
      // Unscoped, deleting *any* view switches the owner's notifications off wherever
      // the bell actually is, emits a spurious `NotifyMeQueryCleared`, and leaves nothing
      // on screen to explain why the pings stopped.
      const owner = await seedOnboardedUser('dusty_views_delete_other_bell');
      const { save, setNotify, remove, list } = services();

      const rides = await save.save({ actorId: owner, name: 'Rides', sourceText: 'type:offer' });
      const events = await save.save({ actorId: owner, name: 'Events', sourceText: 'type:event' });

      await setNotify.set({ actorId: owner, viewId: rides.id, notify: true });

      await expect(remove.delete({ actorId: owner, viewId: events.id })).resolves.toEqual({
        viewId: events.id,
        deleted: true,
      });

      // The bell is still on `rides`, and the designation still points at it by id.
      const listing = await list.list({ viewerId: owner });
      expect(listing.views.map((each) => each.id)).toEqual([rides.id]);
      expect(listing.notifyingViewIds).toEqual([rides.id]);

      const rows = await notifyMeRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.source_view_id).toBe(rides.id);

      // Nothing was cleared, so nothing may claim it was: a spurious `NotifyMeQueryCleared`
      // is what a downstream consumer would act on to stop sending.
      expect(await outboxEventTypes()).toEqual(['NotifyMeQueryChanged']);
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

  describe('Scenario: several bells may be lit at once, and each is its own switch (#172, D16)', () => {
    it('writes one notify_me_queries row per lit bell rather than moving a single one', async () => {
      // ⚠ This test used to assert the opposite — "writes exactly one row however many
      // bells are tapped" — and it was right until the owner reopened D1. What it holds
      // down now is #172 AC1: a second bell *adds* a notification.
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
      ).resolves.toEqual({ notifyingViewIds: [rides.id] });

      const bothLit = await setNotify.set({ actorId: owner, viewId: events.id, notify: true });
      // Sorted on both sides: `notifyingViewIds` is a set with a deterministic order, and
      // asserting the order the repository happens to emit would pin something nothing
      // renders.
      expect([...bothLit.notifyingViewIds].sort()).toEqual([rides.id, events.id].sort());

      // Two rows, each carrying its own view's query text — not one row rewritten twice.
      // The text is the assertion that catches a bell that "lit" by overwriting its
      // neighbour, which a count alone would let through.
      expect([...(await notifyMeRows())].sort(bySourceText)).toEqual(
        [
          {
            owner_id: owner,
            source_text: 'type:offer truck',
            source_view_id: rides.id,
            version: 1,
          },
          { owner_id: owner, source_text: 'type:event', source_view_id: events.id, version: 1 },
        ].sort(bySourceText),
      );

      expect([...(await list.list({ viewerId: owner })).notifyingViewIds].sort()).toEqual(
        [rides.id, events.id].sort(),
      );
      expect(await outboxEventTypes()).toEqual(['NotifyMeQueryChanged', 'NotifyMeQueryChanged']);
    });

    it('switches one bell off without touching the others (#172 AC2)', async () => {
      const owner = await seedOnboardedUser('dusty_views_bell_independent');
      const { save, setNotify, list } = services();

      const rides = await save.save({ actorId: owner, name: 'Rides', sourceText: 'type:offer' });
      const events = await save.save({ actorId: owner, name: 'Events', sourceText: 'type:event' });
      const kitchen = await save.save({
        actorId: owner,
        name: 'Kitchen',
        sourceText: 'type:request',
      });

      for (const view of [rides, events, kitchen]) {
        // Sequential, because the cap is counted per transaction and a concurrent burst
        // would be testing the race rather than the feature.
        await setNotify.set({ actorId: owner, viewId: view.id, notify: true });
      }

      const afterOff = await setNotify.set({ actorId: owner, viewId: events.id, notify: false });
      expect([...afterOff.notifyingViewIds].sort()).toEqual([rides.id, kitchen.id].sort());

      // ⚠ The other two are still lit *and still their own queries* — the failure this
      // guards against is a clear scoped to `owner_id` alone, which would switch off
      // everything while answering exactly as a correct one does for the view named.
      expect([...(await notifyMeRows())].sort(bySourceText)).toEqual(
        [
          { owner_id: owner, source_text: 'type:offer', source_view_id: rides.id, version: 1 },
          { owner_id: owner, source_text: 'type:request', source_view_id: kitchen.id, version: 1 },
        ].sort(bySourceText),
      );

      expect([...(await list.list({ viewerId: owner })).notifyingViewIds].sort()).toEqual(
        [rides.id, kitchen.id].sort(),
      );
      expect(await outboxEventTypes()).toEqual([
        'NotifyMeQueryChanged',
        'NotifyMeQueryChanged',
        'NotifyMeQueryChanged',
        'NotifyMeQueryCleared',
      ]);
    });

    it('clears the query when the only bell is switched off, and says so on the outbox', async () => {
      const owner = await seedOnboardedUser('dusty_views_bell_off');
      const { save, setNotify, list } = services();

      const view = await save.save({ actorId: owner, name: 'Rides', sourceText: 'type:offer' });
      await setNotify.set({ actorId: owner, viewId: view.id, notify: true });

      await expect(
        setNotify.set({ actorId: owner, viewId: view.id, notify: false }),
      ).resolves.toEqual({ notifyingViewIds: [] });

      expect(await notifyMeRows()).toHaveLength(0);
      expect((await list.list({ viewerId: owner })).notifyingViewIds).toEqual([]);
      expect(await outboxEventTypes()).toEqual(['NotifyMeQueryChanged', 'NotifyMeQueryCleared']);
    });

    it('converges when the same bell is lit twice rather than accumulating queries', async () => {
      // The unique constraint's other half: `(owner_id, source_view_id)` means a double
      // tap upserts onto the row that is already there. Without it a person could stack
      // duplicate queries on one card and be pushed about the same bulletin twice.
      const owner = await seedOnboardedUser('dusty_views_bell_twice');
      const { save, setNotify } = services();

      const view = await save.save({ actorId: owner, name: 'Rides', sourceText: 'type:offer' });

      await setNotify.set({ actorId: owner, viewId: view.id, notify: true });
      await expect(
        setNotify.set({ actorId: owner, viewId: view.id, notify: true }),
      ).resolves.toEqual({ notifyingViewIds: [view.id] });

      expect(await notifyMeRows()).toEqual([
        {
          owner_id: owner,
          source_text: 'type:offer',
          source_view_id: view.id,
          // Bumped by the second tap, so a client holding a stale expectedVersion cannot
          // overwrite a designation it never saw (ADR-0005:98).
          version: 2,
        },
      ]);
    });

    it('does not switch off a bell whose view was never lit — a stale client must not undo a live choice', async () => {
      const owner = await seedOnboardedUser('dusty_views_bell_stale');
      const { save, setNotify } = services();

      const rides = await save.save({ actorId: owner, name: 'Rides', sourceText: 'type:offer' });
      const events = await save.save({ actorId: owner, name: 'Events', sourceText: 'type:event' });

      await setNotify.set({ actorId: owner, viewId: events.id, notify: true });

      // A client that still believes `rides` is lit taps it off. Nothing of theirs matches
      // the clear, and the answer is where their bells actually are.
      await expect(
        setNotify.set({ actorId: owner, viewId: rides.id, notify: false }),
      ).resolves.toEqual({ notifyingViewIds: [events.id] });

      expect(await notifyMeRows()).toHaveLength(1);
      // Nothing was cleared, so nothing may claim it was: a spurious `NotifyMeQueryCleared`
      // is what a downstream consumer would act on to stop sending.
      expect(await outboxEventTypes()).toEqual(['NotifyMeQueryChanged']);
    });

    it(`refuses the ${String(NOTIFY_ME_QUERY_LIMIT_PER_OWNER + 1)}th bell, bounding what the evaluator reads per bulletin`, async () => {
      // ⚠ The cap D16 owes D1. D1 bounded the evaluator at one query per person by making
      // that a primary key; reopening it gives that bound up, and this is what replaced it.
      // Deliberately below the saved-view cap, so a person can hold views they are not
      // notifying on — see NOTIFY_ME_QUERY_LIMIT_PER_OWNER for why the two numbers differ.
      const owner = await seedOnboardedUser('dusty_views_bell_cap');
      const { save, setNotify, list } = services();

      const views = [];
      for (let index = 0; index <= NOTIFY_ME_QUERY_LIMIT_PER_OWNER; index += 1) {
        views.push(
          await save.save({
            actorId: owner,
            name: `View ${String(index)}`,
            sourceText: 'type:request',
          }),
        );
      }

      for (const view of views.slice(0, NOTIFY_ME_QUERY_LIMIT_PER_OWNER)) {
        await setNotify.set({ actorId: owner, viewId: view.id, notify: true });
      }

      const overCap = views[NOTIFY_ME_QUERY_LIMIT_PER_OWNER];
      if (overCap === undefined) {
        throw new Error('the cap test needs one more view than the cap');
      }

      await expect(
        setNotify.set({ actorId: owner, viewId: overCap.id, notify: true }),
      ).rejects.toBeInstanceOf(NotifyMeQueryLimitReachedError);

      // Refused rather than silently swapped: the bells that were on are still on, and the
      // refusal wrote no row and announced nothing.
      expect(await notifyMeRows()).toHaveLength(NOTIFY_ME_QUERY_LIMIT_PER_OWNER);
      expect((await list.list({ viewerId: owner })).notifyingViewIds).not.toContain(overCap.id);
      expect(await outboxEventTypes()).toHaveLength(NOTIFY_ME_QUERY_LIMIT_PER_OWNER);

      // ⚠ At the cap, re-lighting a bell that is already lit must still work: it adds
      // nothing to count, and refusing it would make the cap a trap somebody springs by
      // tapping a control that is already on.
      const alreadyLit = views[0];
      if (alreadyLit === undefined) {
        throw new Error('the cap test needs at least one lit view');
      }
      await expect(
        setNotify.set({ actorId: owner, viewId: alreadyLit.id, notify: true }),
      ).resolves.toBeDefined();
    });

    it('lets someone at the bell cap still save their untied query, which the cap does not count', async () => {
      // ⚠ **The cap counts bells, and this is the assertion that says so.** Counting every
      // row of an owner's instead — which is what the first cut did — spends a slot on a
      // query that sits on no card, so a person with six bells lit could not use
      // `views.notifyMe.update` at all, and the refusal they met ("switch one off") pointed
      // at cards that could not free the slot. There is deliberately **no cap on this
      // path**: the untied row is held at one per person by the unique key, so a count
      // there would bound nothing the key does not.
      const owner = await seedOnboardedUser('dusty_views_untied_cap');
      const { save, setNotify, updateNotifyMe, list } = services();

      for (let index = 0; index < NOTIFY_ME_QUERY_LIMIT_PER_OWNER; index += 1) {
        // Sequential for the cap test's reason: counted per transaction, so a concurrent
        // burst would be testing the race rather than the bound.
        const view = await save.save({
          actorId: owner,
          name: `View ${String(index)}`,
          sourceText: 'type:request',
        });
        await setNotify.set({ actorId: owner, viewId: view.id, notify: true });
      }

      const untied = await updateNotifyMe.update({ actorId: owner, sourceText: 'type:offer' });
      expect(untied.sourceText).toBe('type:offer');
      expect(untied.sourceViewId).toBeNull();

      // Seven rows: six bells plus the one untied query. That total is the honest worst
      // case per person, and it is what the evaluator's bound actually is.
      expect(await notifyMeRows()).toHaveLength(NOTIFY_ME_QUERY_LIMIT_PER_OWNER + 1);
      // The untied query lights no card, so the screen is unchanged by it.
      expect((await list.list({ viewerId: owner })).notifyingViewIds).toHaveLength(
        NOTIFY_ME_QUERY_LIMIT_PER_OWNER,
      );

      // ⚠ And the bell cap still bites. Without this, an implementation that had simply
      // deleted the cap everywhere would pass every assertion above.
      const spare = await save.save({
        actorId: owner,
        name: 'One too many',
        sourceText: 'type:event',
      });
      await expect(
        setNotify.set({ actorId: owner, viewId: spare.id, notify: true }),
      ).rejects.toBeInstanceOf(NotifyMeQueryLimitReachedError);
    });

    it('stops the notifications when a view a bell is on is deleted, and only that one', async () => {
      const owner = await seedOnboardedUser('dusty_views_bell_deleted');
      const { save, setNotify, remove, list } = services();

      const rides = await save.save({ actorId: owner, name: 'Rides', sourceText: 'type:offer' });
      const events = await save.save({ actorId: owner, name: 'Events', sourceText: 'type:event' });
      await setNotify.set({ actorId: owner, viewId: rides.id, notify: true });
      await setNotify.set({ actorId: owner, viewId: events.id, notify: true });

      await expect(remove.delete({ actorId: owner, viewId: rides.id })).resolves.toEqual({
        viewId: rides.id,
        deleted: true,
      });

      // The bell that turned those on was on the card that just disappeared; leaving the
      // query would push notifications with no surface left to switch them off. The bell on
      // `events` is untouched, because a delete is not a reason to stop anything else.
      expect(await notifyMeRows()).toEqual([
        { owner_id: owner, source_text: 'type:event', source_view_id: events.id, version: 1 },
      ]);
      expect((await list.list({ viewerId: owner })).notifyingViewIds).toEqual([events.id]);
      expect(await outboxEventTypes()).toEqual([
        'NotifyMeQueryChanged',
        'NotifyMeQueryChanged',
        'NotifyMeQueryCleared',
      ]);
    });

    it('leaves every lit bell alone when views.notifyMe.update writes an untied query', async () => {
      // ⚠ **This assertion is the inverse of the one it replaces, and the inversion is
      // D16.** Under D1 there was a single query per person, so writing one here took it
      // away from whichever view it had been designated from and the card went dark. A
      // person now has an untied query *and* their bells, independently: the two write
      // paths address different rows and cannot reach each other.
      const owner = await seedOnboardedUser('dusty_views_notify_direct');
      const { save, setNotify, updateNotifyMe, list } = services();

      const view = await save.save({ actorId: owner, name: 'Rides', sourceText: 'type:offer' });
      await setNotify.set({ actorId: owner, viewId: view.id, notify: true });

      // No `expectedVersion`: this person has no untied query yet, and the designated one
      // is not it. Supplying the designation's version would be a conflict for that reason.
      await updateNotifyMe.update({ actorId: owner, sourceText: 'type:request' });

      expect([...(await notifyMeRows())].sort(bySourceText)).toEqual(
        [
          { owner_id: owner, source_text: 'type:offer', source_view_id: view.id, version: 1 },
          { owner_id: owner, source_text: 'type:request', source_view_id: null, version: 1 },
        ].sort(bySourceText),
      );
      // The untied query belongs to no view, so it lights no card — the one thing about
      // this screen that D16 did not change.
      expect((await list.list({ viewerId: owner })).notifyingViewIds).toEqual([view.id]);
    });

    it('refuses a notifyMe.update carrying a designated query’s version, rather than rewriting it', async () => {
      // ⚠ The designated rows are unreachable from this procedure *by predicate*, not by
      // luck: `source_view_id is null` is on the UPDATE. Without it, an actor whose only
      // query is behind a lit bell would have that bell's query silently rewritten to text
      // the card does not say — the exact failure the pointer exists to prevent.
      const owner = await seedOnboardedUser('dusty_views_notify_direct_version');
      const { save, setNotify, updateNotifyMe, list } = services();

      const view = await save.save({ actorId: owner, name: 'Rides', sourceText: 'type:offer' });
      await setNotify.set({ actorId: owner, viewId: view.id, notify: true });

      await expect(
        updateNotifyMe.update({ actorId: owner, sourceText: 'type:request', expectedVersion: 1 }),
      ).rejects.toBeInstanceOf(NotifyMeQueryConflictError);

      expect(await notifyMeRows()).toEqual([
        { owner_id: owner, source_text: 'type:offer', source_view_id: view.id, version: 1 },
      ]);
      expect((await list.list({ viewerId: owner })).notifyingViewIds).toEqual([view.id]);
    });
  });

  /**
   * Scenario: the *designation* is owner-scoped too, not just the views (M5-AC16).
   *
   * The M5-AC16 block above proves the `app.saved_views` statements are scoped — an
   * actor listing sees none of another owner's rows, and rename/delete/setNotify all
   * refuse. It cannot say anything about the four statements that read or write
   * `app.notify_me_queries`, because **no owner in it has a bell lit**: with that table
   * empty, `listFor`'s second query, `designatedViewIds`, and the clear inside `delete`
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

      expect(listing.notifyingViewIds).toEqual([]);
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

      // Both assertions in one test on purpose. Unscoped, the read returns *both* rows and
      // each owner is handed the other's view id alongside their own — so each assertion
      // fails on the extra element, whichever order the plan emits them in. (Before #172
      // the same test rested on `executeTakeFirst` picking one row that could be right for
      // at most one owner; the reasoning changed with the read, the conclusion did not.)
      expect((await list.list({ viewerId: ownerA })).notifyingViewIds).toEqual([viewA.id]);
      expect((await list.list({ viewerId: ownerB })).notifyingViewIds).toEqual([viewB.id]);
    });

    it("answers a no-op bell-off with the caller's own designation, never another owner's", async () => {
      const ownerA = await seedOnboardedUser('dusty_designation_noop_a');
      const ownerB = await seedOnboardedUser('dusty_designation_noop_b');
      const { save, setNotify } = services();

      const viewA = await save.save({ actorId: ownerA, name: 'A rides', sourceText: 'type:offer' });
      await setNotify.set({ actorId: ownerA, viewId: viewA.id, notify: true });

      const viewB = await save.save({ actorId: ownerB, name: 'B events', sourceText: 'type:event' });

      // B taps off a bell that was never on. Nothing of B's matches the clear, so the
      // repository falls through to `designatedViewIds` — "where are my bells actually?",
      // the read on that path, reached here while `app.notify_me_queries` holds a row
      // belonging to somebody else. Unscoped it answers with A's.
      await expect(
        setNotify.set({ actorId: ownerB, viewId: viewB.id, notify: false }),
      ).resolves.toEqual({ notifyingViewIds: [] });

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

/**
 * Order two Notify Me rows by the query text they carry.
 *
 * A person may now hold several, and nothing about the table promises which comes back
 * first. Sorting by `source_text` rather than by `source_view_id` keeps the expected
 * literals in these tests readable — the text is what a reader recognises; a uuid is not.
 */
function bySourceText(left: { source_text: string }, right: { source_text: string }): number {
  return left.source_text.localeCompare(right.source_text);
}

/** Mirrors `packages/database/src/database-schema.integration.test.ts`'s helper. */
function asRole(connectionString: string, username: string, password: string): string {
  const url = new URL(connectionString);
  url.username = username;
  url.password = password;
  return url.toString();
}

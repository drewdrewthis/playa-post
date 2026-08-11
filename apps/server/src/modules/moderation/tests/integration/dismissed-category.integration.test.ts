import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseConnection, type DatabaseConnection } from '@playa-post/database';
import { createLogger } from '@playa-post/observability';
import { startPostgresTestDatabase, type PostgresTestDatabase } from '@playa-post/testing';

import type { AuthenticationOutcome } from '../../../../shared/auth/authenticate-request';
import type { RequestContext } from '../../../../shared/trpc/request-context';
import { createCallerFactory, router } from '../../../../shared/trpc/trpc';
// L3a's public module factory — the only sanctioned cross-module surface, per the same
// `no-cross-module-persistence` rule `moderation-report-dismiss.integration.test.ts`
// records (the fitness suite enforces it over test files too). Every bulletin fixture
// here is created and read through `bulletinsModule.router`.
import { createBulletinsModule, type BulletinsModule } from '../../../bulletins/bulletins.module';
import {
  createDismissedBulletins,
  createModerationModule,
  type ModerationModule,
} from '../../moderation.module';
import { createPostgresModerationRepository } from '../../persistence/postgres-moderation.repository';

/**
 * `specs/features/moderation-report-dismiss.feature` — issue #170's ten `@integration`
 * scenarios: the Dismissed category, and the way back out of it.
 *
 * **Why this is a second file beside `moderation-report-dismiss.integration.test.ts`
 * rather than more `describe`s inside it.** That suite is about a hide taking effect and
 * staying private; this one is about what a viewer can do with their own dismissals
 * afterwards, and it reads both modules' routers together in every scenario. One file
 * per feature *half* keeps each one readable, and the shared fixtures below are small
 * enough that duplicating them costs less than a third file to import them from.
 *
 * **What the read is, and where it lives.** The category is `bulletins.dismissed`, not a
 * `moderation.*` procedure: `modules/moderation` still exposes no read at all, and the
 * bulletin content comes from `app.visible_bulletins` — the one authorized set
 * (ADR-0002 §6). `modules/moderation` answers only *which identifiers* the viewer
 * dismissed, through `createDismissedBulletins`. The two halves are wired together here
 * exactly as `composition/container.ts` wires them.
 *
 * ⚠ **The scenario that matters most is the one asserting a report is not in the list.**
 * `findHiddenFor` unions both moderation tables and `findDismissedFor` does not; nothing
 * but a test distinguishes them, and confusing the two publishes a list of what the
 * viewer reported (M2-AC10, B9).
 */
describe('the Dismissed category and un-dismissal (moderation-report-dismiss.feature, #170)', () => {
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

  async function seedOnboardedUser(
    handle: string,
  ): Promise<{ userId: string; handle: string }> {
    const { rows } = await testDatabase.client.query<{ id: string }>(
      `insert into app.users (auth_user_id, handle, display_name, created_at)
       values ($1, $2, $3, now()) returning id`,
      [randomUUID(), handle, handle],
    );
    const userId = rows[0]?.id;
    if (userId === undefined) {
      throw new Error('seedOnboardedUser: insert returned no row');
    }
    return { userId, handle };
  }

  async function seedAcceptedConnection(userAId: string, userBId: string): Promise<void> {
    await testDatabase.client.query(
      `insert into app.connections
         (user_a_id, user_b_id, status, a_discloses_to_b_level, b_discloses_to_a_level, created_at)
       values ($1, $2, 'accepted', 'full', 'full', now())`,
      [userAId, userBId],
    );
  }

  async function outboxRowCount(): Promise<number> {
    const { rows } = await testDatabase.client.query<{ count: string }>(
      'select count(*)::text as count from app.outbox_events',
    );
    return Number(rows[0]?.count ?? '0');
  }

  async function dismissalRowCount(): Promise<number> {
    const { rows } = await testDatabase.client.query<{ count: string }>(
      'select count(*)::text as count from app.bulletin_dismissals',
    );
    return Number(rows[0]?.count ?? '0');
  }

  /** A context that skips JWT verification — the auth stack is proven by its own suite. */
  function contextForActor(actor: { userId: string; handle: string }): RequestContext {
    const outcome: AuthenticationOutcome = {
      kind: 'authenticated',
      principal: { authUserId: 'unused-in-this-suite' },
      actor,
    };
    return {
      correlationId: 'correlation-id-for-test',
      logger: createLogger({ level: 'silent' }),
      authentication: () => Promise.resolve(outcome),
    };
  }

  /**
   * Both modules, wired the way `composition/container.ts` wires them.
   *
   * ⚠ Two *separate* moderation reads on purpose — `hiddenBulletins` unions reports and
   * dismissals, `dismissedBulletins` does not. Passing one object to both parameters
   * would be the wiring mistake this suite exists to catch, and the compiler would not.
   */
  function wireModules() {
    const bulletinsModule: BulletinsModule = createBulletinsModule({
      database,
      hiddenBulletins: createPostgresModerationRepository({ database }),
      dismissedBulletins: createDismissedBulletins({ database }),
    });
    const moderationModule: ModerationModule = createModerationModule({
      database,
      findVisibleBulletin: bulletinsModule.findVisibleBulletin,
    });
    const createCaller = createCallerFactory(
      router({ bulletins: bulletinsModule.router, moderation: moderationModule.router }),
    );

    return {
      callerFor: (actor: { userId: string; handle: string }): ReturnType<typeof createCaller> =>
        createCaller(contextForActor(actor)),
    };
  }

  describe('Scenario: A dismissed bulletin is browsable in the viewer’s dismissed category', () => {
    it("lists it with its author's disclosure card while keeping it off the board", async () => {
      const { callerFor } = wireModules();
      const userA = await seedOnboardedUser('dusty_dis_browse_a');
      const viewerV = await seedOnboardedUser('dusty_dis_browse_v');
      await seedAcceptedConnection(userA.userId, viewerV.userId);

      const created = await callerFor(userA).bulletins.create({
        type: 'offer',
        title: 'Spare goggles',
        body: 'Two pairs, barely used.',
      });

      const viewer = callerFor(viewerV);
      await viewer.moderation.dismiss({ bulletinId: created.id });

      const dismissed = await viewer.bulletins.dismissed();
      const board = await viewer.bulletins.board({});

      expect(dismissed.items.map((item) => item.id)).toEqual([created.id]);
      expect(dismissed.items[0]?.title).toBe('Spare goggles');
      // §6a: the author card is projected by `app.visible_bulletins`, not assembled here.
      // A full-disclosure connection means the name is present — the point being that the
      // category goes through the same projection the board does, not around it.
      expect(dismissed.items[0]?.author.userId).toBe(userA.userId);
      expect(dismissed.items[0]?.author.disclosure).toBe('full');
      expect(board.items.some((item) => item.id === created.id)).toBe(false);
    });
  });

  describe('Scenario: The dismissed category lists most-recently-dismissed first', () => {
    it('orders by dismissal, not by when each bulletin was posted', async () => {
      const { callerFor } = wireModules();
      const userA = await seedOnboardedUser('dusty_dis_order_a');
      const viewerV = await seedOnboardedUser('dusty_dis_order_v');
      await seedAcceptedConnection(userA.userId, viewerV.userId);

      const author = callerFor(userA);
      const first = await author.bulletins.create({
        type: 'offer',
        title: 'Posted first',
        body: 'Oldest bulletin.',
      });
      const second = await author.bulletins.create({
        type: 'offer',
        title: 'Posted second',
        body: 'Middle bulletin.',
      });
      const third = await author.bulletins.create({
        type: 'offer',
        title: 'Posted third',
        body: 'Newest bulletin.',
      });

      const viewer = callerFor(viewerV);
      // Dismissed in an order deliberately unrelated to the posting order, so a category
      // that had silently fallen back to `created_at desc` cannot pass.
      await viewer.moderation.dismiss({ bulletinId: second.id });
      await viewer.moderation.dismiss({ bulletinId: third.id });
      await viewer.moderation.dismiss({ bulletinId: first.id });

      const dismissed = await viewer.bulletins.dismissed();

      expect(dismissed.items.map((item) => item.id)).toEqual([first.id, third.id, second.id]);
    });
  });

  describe('Scenario: The dismissed category never carries what the viewer reported', () => {
    it('lists the dismissed bulletin and not the reported one', async () => {
      const { callerFor } = wireModules();
      const userA = await seedOnboardedUser('dusty_dis_report_a');
      const viewerV = await seedOnboardedUser('dusty_dis_report_v');
      await seedAcceptedConnection(userA.userId, viewerV.userId);

      const author = callerFor(userA);
      const reported = await author.bulletins.create({
        type: 'offer',
        title: 'The reported one',
        body: 'V will report this.',
      });
      const dismissedBulletin = await author.bulletins.create({
        type: 'offer',
        title: 'The dismissed one',
        body: 'V will dismiss this.',
      });

      const viewer = callerFor(viewerV);
      await viewer.moderation.report({
        bulletinId: reported.id,
        reason: 'spam',
        detail: 'Nothing but adverts.',
      });
      await viewer.moderation.dismiss({ bulletinId: dismissedBulletin.id });

      const dismissed = await viewer.bulletins.dismissed();
      const board = await viewer.bulletins.board({});

      expect(dismissed.items.map((item) => item.id)).toEqual([dismissedBulletin.id]);
      // Both left the board. Only one of them is browsable, and the reported one's title
      // must not reach this response at any nesting depth (M2-AC10, B9).
      expect(board.items.some((item) => item.id === reported.id)).toBe(false);
      expect(JSON.stringify(dismissed)).not.toContain('The reported one');
    });
  });

  describe("Scenario: The dismissed category carries nobody else's dismissals", () => {
    it("lists only the caller's own", async () => {
      const { callerFor } = wireModules();
      const userA = await seedOnboardedUser('dusty_dis_mine_a');
      const viewerV = await seedOnboardedUser('dusty_dis_mine_v');
      const viewerW = await seedOnboardedUser('dusty_dis_mine_w');
      await seedAcceptedConnection(userA.userId, viewerV.userId);
      await seedAcceptedConnection(userA.userId, viewerW.userId);

      const author = callerFor(userA);
      const forV = await author.bulletins.create({
        type: 'offer',
        title: 'V dismisses this',
        body: 'Body.',
      });
      const forW = await author.bulletins.create({
        type: 'offer',
        title: 'W dismisses this',
        body: 'Body.',
      });

      await callerFor(viewerV).moderation.dismiss({ bulletinId: forV.id });
      await callerFor(viewerW).moderation.dismiss({ bulletinId: forW.id });

      const dismissedForV = await callerFor(viewerV).bulletins.dismissed();

      expect(dismissedForV.items.map((item) => item.id)).toEqual([forV.id]);
      expect(JSON.stringify(dismissedForV)).not.toContain('W dismisses this');
    });
  });

  describe('Scenario: The dismissed category only carries bulletins the viewer may still see', () => {
    it('drops one the author has since removed', async () => {
      const { callerFor } = wireModules();
      const userA = await seedOnboardedUser('dusty_dis_gone_a');
      const viewerV = await seedOnboardedUser('dusty_dis_gone_v');
      await seedAcceptedConnection(userA.userId, viewerV.userId);

      const created = await callerFor(userA).bulletins.create({
        type: 'offer',
        title: 'Soon removed',
        body: 'The author will take this down.',
      });

      await callerFor(viewerV).moderation.dismiss({ bulletinId: created.id });
      await callerFor(userA).bulletins.archive({ bulletinId: created.id });

      const dismissed = await callerFor(viewerV).bulletins.dismissed();

      expect(dismissed.items).toEqual([]);
      // The decision itself survives — the row is still there, so if the bulletin ever
      // becomes visible again the viewer's dismissal of it has not been forgotten.
      expect(await dismissalRowCount()).toBe(1);
    });
  });

  describe('Scenario: Un-dismissing returns the bulletin to the default board', () => {
    it('puts it back and empties the category', async () => {
      const { callerFor } = wireModules();
      const userA = await seedOnboardedUser('dusty_dis_undo_a');
      const viewerV = await seedOnboardedUser('dusty_dis_undo_v');
      await seedAcceptedConnection(userA.userId, viewerV.userId);

      const created = await callerFor(userA).bulletins.create({
        type: 'offer',
        title: 'Back on the board',
        body: 'Dismissed, then not.',
      });

      const viewer = callerFor(viewerV);
      await viewer.moderation.dismiss({ bulletinId: created.id });
      expect((await viewer.bulletins.board({})).items.some((item) => item.id === created.id)).toBe(
        false,
      );

      const restored = await viewer.moderation.undismiss({ bulletinId: created.id });

      expect(restored).toEqual({ bulletinId: created.id });
      expect((await viewer.bulletins.board({})).items.some((item) => item.id === created.id)).toBe(
        true,
      );
      expect((await viewer.bulletins.dismissed()).items).toEqual([]);
      expect(await dismissalRowCount()).toBe(0);
    });
  });

  describe('Scenario: Un-dismissing something never dismissed succeeds and changes nothing', () => {
    it('converges rather than refusing', async () => {
      const { callerFor } = wireModules();
      const userA = await seedOnboardedUser('dusty_dis_noop_a');
      const viewerV = await seedOnboardedUser('dusty_dis_noop_v');
      await seedAcceptedConnection(userA.userId, viewerV.userId);

      const created = await callerFor(userA).bulletins.create({
        type: 'offer',
        title: 'Never dismissed',
        body: 'V will undo a dismissal that never happened.',
      });
      const outboxBefore = await outboxRowCount();

      const viewer = callerFor(viewerV);
      await expect(viewer.moderation.undismiss({ bulletinId: created.id })).resolves.toEqual({
        bulletinId: created.id,
      });

      expect(await dismissalRowCount()).toBe(0);
      expect(await outboxRowCount()).toBe(outboxBefore);
      expect((await viewer.bulletins.board({})).items.some((item) => item.id === created.id)).toBe(
        true,
      );
    });
  });

  describe('Scenario: Un-dismissing a bulletin the viewer also reported leaves it hidden', () => {
    it('withdraws the dismissal and keeps the report', async () => {
      const { callerFor } = wireModules();
      const userA = await seedOnboardedUser('dusty_dis_both_a');
      const viewerV = await seedOnboardedUser('dusty_dis_both_v');
      await seedAcceptedConnection(userA.userId, viewerV.userId);

      const created = await callerFor(userA).bulletins.create({
        type: 'offer',
        title: 'Dismissed and reported',
        body: 'Undoing one must not undo the other.',
      });

      const viewer = callerFor(viewerV);
      await viewer.moderation.dismiss({ bulletinId: created.id });
      await viewer.moderation.report({
        bulletinId: created.id,
        reason: 'harassment',
        detail: 'This is why the stewards need to see it.',
      });

      await viewer.moderation.undismiss({ bulletinId: created.id });

      expect((await viewer.bulletins.board({})).items.some((item) => item.id === created.id)).toBe(
        false,
      );
      // Out of the category, because the dismissal is gone. Still off the board, because
      // the report is not.
      expect((await viewer.bulletins.dismissed()).items).toEqual([]);

      const { rows } = await testDatabase.client.query<{ count: string }>(
        'select count(*)::text as count from app.bulletin_reports where bulletin_id = $1',
        [created.id],
      );
      expect(Number(rows[0]?.count ?? '0')).toBe(1);
    });
  });

  describe('Scenario: Dismissing leaves the bulletin untouched for its author', () => {
    it("keeps it on the author's own list, unarchived", async () => {
      const { callerFor } = wireModules();
      const userA = await seedOnboardedUser('dusty_dis_author_a');
      const viewerV = await seedOnboardedUser('dusty_dis_author_v');
      await seedAcceptedConnection(userA.userId, viewerV.userId);

      const author = callerFor(userA);
      const created = await author.bulletins.create({
        type: 'offer',
        title: 'Still mine',
        body: "V dismissing it changes nothing about the bulletin.",
      });

      await callerFor(viewerV).moderation.dismiss({ bulletinId: created.id });

      const own = await author.bulletins.listMine();
      const mine = own.find((bulletin) => bulletin.id === created.id);

      expect(mine).toBeDefined();
      expect(mine?.archivedAt).toBeNull();
      expect(mine?.version).toBe(created.version);
      // The author's own dismissed category is empty: dismissing is the viewer's act, and
      // it is not visible to the author in any form.
      expect((await author.bulletins.dismissed()).items).toEqual([]);
    });
  });

  describe('Scenario: bulletin.undismiss fails closed for an unrelated actor', () => {
    it('answers a structured error, writes no row, and publishes nothing', async () => {
      const { callerFor } = wireModules();
      const userA = await seedOnboardedUser('dusty_dis_unrelated_a');
      const actorC = await seedOnboardedUser('dusty_dis_unrelated_c');

      const created = await callerFor(userA).bulletins.create({
        type: 'offer',
        title: 'Nothing to do with C',
        body: 'Actor C has no relationship to this at all.',
      });
      const outboxBefore = await outboxRowCount();

      await expect(
        callerFor(actorC).moderation.undismiss({ bulletinId: created.id }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      expect(await dismissalRowCount()).toBe(0);
      expect(await outboxRowCount()).toBe(outboxBefore);

      // A UUID that never existed is refused identically — un-dismissing must not become
      // an oracle for which bulletins exist (ADR-0002 §10, B17, M2-AC14).
      await expect(
        callerFor(actorC).moderation.undismiss({ bulletinId: randomUUID() }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
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

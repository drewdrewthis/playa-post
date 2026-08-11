import { describe, expect, it } from 'vitest';

import { viewerIdFromActor, type ViewerId } from '../../../../shared/auth/viewer-id';
import type {
  DeliveredNoteNotification,
  DeliveredNotificationMatch,
  DeliveredNotificationRepository,
} from '../../application/delivered-notification.repository';
import { createListNotificationsQuery } from '../../application/list-notifications.query';
import { createMarkNotificationsSeenService } from '../../application/mark-notifications-seen.service';
import type { NotificationDismissal } from '../../domain/notification-dismissal';
import type {
  DismissNotificationWrite,
  NotificationDismissalRepository,
} from '../../domain/notification-dismissal.repository';
import type { NotificationSeenMark } from '../../domain/notification-seen-mark';
import type {
  MarkNotificationsSeenWrite,
  NotificationSeenWatermarkRepository,
} from '../../domain/notification-seen-watermark.repository';

/**
 * `seen`, and the watermark it is read from — issue #178's badge rule, proven against
 * fakes rather than Postgres.
 *
 * **The rule is one comparison**: a notification is seen when it was already on the list
 * the last time this caller opened their panel, which is `occurredAt <= lastSeenAt`, and
 * is never seen for somebody who has never opened it. Everything interesting is a
 * boundary — no watermark at all, a timestamp exactly on it, one either side of it, and
 * what a *second* open does — and none of those need a container to state.
 *
 * **In-memory fakes, not mocks** (coding standards: don't mock what you own). The
 * assertions are about emitted values — which notifications come back marked, and what
 * moment a second mark answers — never about call sequences. SQL correctness is
 * `notification-seen.integration.test.ts`'s job.
 *
 * ⚠ **`seen` and `unread` are asserted together throughout, never in isolation.** The
 * one thing this feature must not do is collapse the two: opening the panel may not
 * dismiss anything, and dismissing is not "seeing". A test that read only `seen` would
 * stay green through exactly that regression.
 */
describe('notifications seen watermark (issue #178)', () => {
  const recipientId = '00000000-0000-4000-8000-000000000001';
  const viewerId: ViewerId = viewerIdFromActor({ userId: recipientId, handle: 'dusty' });
  const windowStart = new Date('2026-08-01T12:00:00.000Z');

  /** One delivered match, at an offset from the window start. */
  function match(eventId: string, bulletinId: string, offsetMs = 0): DeliveredNotificationMatch {
    return {
      eventId,
      recipientId,
      bulletinId,
      occurredAt: new Date(windowStart.getTime() + offsetMs),
    };
  }

  /** One delivered note notification, at an offset from the window start. */
  function note(eventId: string, noteId: string, offsetMs = 0): DeliveredNoteNotification {
    return {
      eventId,
      noteId,
      occurredAt: new Date(windowStart.getTime() + offsetMs),
    };
  }

  /** Everything delivered is visible — the authorization post-filter has its own suites. */
  function fakeDelivered(
    matches: readonly DeliveredNotificationMatch[],
    notes: readonly DeliveredNoteNotification[] = [],
  ): DeliveredNotificationRepository {
    return {
      findDeliveredMatches: async () => matches,
      findVisibleBulletinIds: async (_viewer, bulletinIds) => bulletinIds,
      findDeliveredNoteNotifications: async () => notes,
      findVisibleNoteIds: async (_viewer, noteIds) => noteIds,
      hasDeliveredMatch: async (owner, notificationId) =>
        owner === recipientId &&
        [...matches, ...notes].some((candidate) => candidate.eventId === notificationId),
    };
  }

  /** An in-memory `app.notification_dismissals`. */
  function fakeDismissals(seeded: readonly string[] = []): NotificationDismissalRepository {
    const rows = new Map<string, Date>(
      seeded.map((notificationId) => [notificationId, new Date('2026-07-01T00:00:00.000Z')]),
    );

    return {
      async dismiss(write: DismissNotificationWrite): Promise<NotificationDismissal> {
        const existing = rows.get(write.notificationId);
        if (existing !== undefined) {
          return { notificationId: write.notificationId, dismissedAt: existing };
        }
        rows.set(write.notificationId, write.occurredAt);
        return { notificationId: write.notificationId, dismissedAt: write.occurredAt };
      },
      findDismissedFor: async () => new Set(rows.keys()),
    };
  }

  /**
   * An in-memory `app.notification_seen_watermarks` — one row per recipient, replaced
   * rather than appended, which is the whole shape of the real table.
   */
  function fakeSeenWatermarks(seeded: Date | null = null): NotificationSeenWatermarkRepository {
    const rows = new Map<string, Date>(seeded === null ? [] : [[recipientId, seeded]]);

    return {
      async markSeen(write: MarkNotificationsSeenWrite): Promise<NotificationSeenMark> {
        rows.set(write.recipientId, write.occurredAt);
        return { seenAt: write.occurredAt };
      },
      findSeenWatermarkFor: async (owner: string) => rows.get(owner) ?? null,
    };
  }

  describe('list', () => {
    it('marks everything unseen while the caller has never opened the panel', async () => {
      const query = createListNotificationsQuery({
        deliveredNotifications: fakeDelivered([match('event-1', 'bulletin-1')]),
        dismissals: fakeDismissals(),
        seenWatermarks: fakeSeenWatermarks(),
      });

      const listed = await query.list({ viewerId });

      expect(listed).toHaveLength(1);
      expect(listed[0]?.seen).toBe(false);
      // Still unread: never having looked is not the same as having dealt with it.
      expect(listed[0]?.unread).toBe(true);
    });

    it('marks a notification older than the watermark seen, and leaves it unread', async () => {
      const query = createListNotificationsQuery({
        deliveredNotifications: fakeDelivered([match('event-1', 'bulletin-1')]),
        dismissals: fakeDismissals(),
        seenWatermarks: fakeSeenWatermarks(new Date(windowStart.getTime() + 1_000)),
      });

      const listed = await query.list({ viewerId });

      expect(listed[0]?.seen).toBe(true);
      expect(listed[0]?.unread).toBe(true);
    });

    it('counts a notification stamped EXACTLY on the watermark as seen', async () => {
      // The inclusive boundary is a decision, not an accident: a notification stamped at
      // the instant the panel opened was on the list the reader was shown. An exclusive
      // comparison would leave that one row holding the badge up forever, because no
      // later open can ever move a watermark past a timestamp it equals on the nose.
      const query = createListNotificationsQuery({
        deliveredNotifications: fakeDelivered([match('event-1', 'bulletin-1')]),
        dismissals: fakeDismissals(),
        seenWatermarks: fakeSeenWatermarks(windowStart),
      });

      expect((await query.list({ viewerId }))[0]?.seen).toBe(true);
    });

    it('leaves a notification that arrived after the watermark unseen', async () => {
      const query = createListNotificationsQuery({
        deliveredNotifications: fakeDelivered([match('event-1', 'bulletin-1', 1_000)]),
        dismissals: fakeDismissals(),
        seenWatermarks: fakeSeenWatermarks(windowStart),
      });

      expect((await query.list({ viewerId }))[0]?.seen).toBe(false);
    });

    it('splits one list either side of the watermark, both kinds alike', async () => {
      // 61 seconds apart so the two matches are two windows (M2-AC7), and a note in
      // between — the watermark is a fact about time, so it must cut across both kinds
      // rather than being a rule about Notify Me groups.
      const query = createListNotificationsQuery({
        deliveredNotifications: fakeDelivered(
          [match('event-old', 'bulletin-1'), match('event-new', 'bulletin-2', 122_000)],
          [note('note-old', 'note-1', 1_000), note('note-new', 'note-2', 123_000)],
        ),
        dismissals: fakeDismissals(),
        seenWatermarks: fakeSeenWatermarks(new Date(windowStart.getTime() + 60_000)),
      });

      const listed = await query.list({ viewerId });

      expect(new Map(listed.map((item) => [item.notificationId, item.seen]))).toEqual(
        new Map([
          ['event-old', true],
          ['note-old', true],
          ['event-new', false],
          ['note-new', false],
        ]),
      );
    });

    it('keys seen on the window opener, the same timestamp the notification is served with', async () => {
      // A window is anchored to its opening match, so `occurredAt` on the wire is the
      // opener's. Comparing the *joiner's* timestamp instead would mark a group unseen
      // whose visible timestamp is older than the watermark — a badge counting a row the
      // reader is looking at.
      const query = createListNotificationsQuery({
        deliveredNotifications: fakeDelivered([
          match('event-opener', 'bulletin-1'),
          match('event-joiner', 'bulletin-2', 59_000),
        ]),
        dismissals: fakeDismissals(),
        seenWatermarks: fakeSeenWatermarks(new Date(windowStart.getTime() + 30_000)),
      });

      const listed = await query.list({ viewerId });

      expect(listed).toHaveLength(1);
      expect(listed[0]?.notificationId).toBe('event-opener');
      expect(listed[0]?.seen).toBe(true);
    });

    it('reports seen and unread independently, in all four combinations', async () => {
      // The regression this feature is most likely to ship: one flag quietly deriving
      // from the other. Two notifications, one dismissed and one not, under a watermark
      // that covers the older of them.
      const query = createListNotificationsQuery({
        deliveredNotifications: fakeDelivered([
          match('seen-and-dismissed', 'bulletin-1'),
          match('seen-not-dismissed', 'bulletin-2', 61_000),
          match('unseen-and-dismissed', 'bulletin-3', 122_000),
          match('unseen-not-dismissed', 'bulletin-4', 183_000),
        ]),
        dismissals: fakeDismissals(['seen-and-dismissed', 'unseen-and-dismissed']),
        seenWatermarks: fakeSeenWatermarks(new Date(windowStart.getTime() + 61_000)),
      });

      const listed = await query.list({ viewerId });

      expect(
        new Map(listed.map((item) => [item.notificationId, { seen: item.seen, unread: item.unread }])),
      ).toEqual(
        new Map([
          ['seen-and-dismissed', { seen: true, unread: false }],
          ['seen-not-dismissed', { seen: true, unread: true }],
          ['unseen-and-dismissed', { seen: false, unread: false }],
          ['unseen-not-dismissed', { seen: false, unread: true }],
        ]),
      );
    });
  });

  describe('markSeen', () => {
    it('writes the watermark, so the next list marks the delivered notifications seen', async () => {
      const deliveredNotifications = fakeDelivered([match('event-1', 'bulletin-1')]);
      const seenWatermarks = fakeSeenWatermarks();
      const service = createMarkNotificationsSeenService({
        seenWatermarks,
        now: () => new Date('2026-08-02T09:00:00.000Z'),
      });
      const query = createListNotificationsQuery({
        deliveredNotifications,
        dismissals: fakeDismissals(),
        seenWatermarks,
      });

      await service.markSeen({ actorId: recipientId });

      const listed = await query.list({ viewerId });
      expect(listed[0]?.seen).toBe(true);
      // ⚠ And nothing was dismissed. Opening the panel is not clearing it.
      expect(listed[0]?.unread).toBe(true);
    });

    it('answers the moment the watermark now stands at', async () => {
      const seenAt = new Date('2026-08-02T09:00:00.000Z');
      const service = createMarkNotificationsSeenService({
        seenWatermarks: fakeSeenWatermarks(),
        now: () => seenAt,
      });

      await expect(service.markSeen({ actorId: recipientId })).resolves.toEqual({ seenAt });
    });

    it('ADVANCES on a repeat rather than converging, unlike a dismissal', async () => {
      // The opposite contract to `notifications.dismiss`, and deliberately so: "I am
      // looking now" is true of every call. A converging watermark would freeze at the
      // first open and never clear a badge again.
      const seenWatermarks = fakeSeenWatermarks();
      let clock = new Date('2026-08-02T09:00:00.000Z');
      const service = createMarkNotificationsSeenService({
        seenWatermarks,
        now: () => clock,
      });

      const first = await service.markSeen({ actorId: recipientId });
      clock = new Date('2026-08-03T09:00:00.000Z');
      const second = await service.markSeen({ actorId: recipientId });

      expect(second.seenAt.getTime()).toBeGreaterThan(first.seenAt.getTime());
      await expect(seenWatermarks.findSeenWatermarkFor(recipientId)).resolves.toEqual(clock);
    });

    it('lets a second open cover a notification the first one could not', async () => {
      // The whole journey in one test: open, something arrives, badge is up again, open
      // again, badge is down.
      const deliveredNotifications = fakeDelivered([
        match('event-early', 'bulletin-1'),
        match('event-late', 'bulletin-2', 61_000),
      ]);
      const seenWatermarks = fakeSeenWatermarks();
      let clock = new Date(windowStart.getTime() + 30_000);
      const service = createMarkNotificationsSeenService({ seenWatermarks, now: () => clock });
      const query = createListNotificationsQuery({
        deliveredNotifications,
        dismissals: fakeDismissals(),
        seenWatermarks,
      });

      await service.markSeen({ actorId: recipientId });
      expect(new Map((await query.list({ viewerId })).map((item) => [item.notificationId, item.seen]))).toEqual(
        new Map([
          ['event-early', true],
          ['event-late', false],
        ]),
      );

      clock = new Date(windowStart.getTime() + 90_000);
      await service.markSeen({ actorId: recipientId });
      expect(new Map((await query.list({ viewerId })).map((item) => [item.notificationId, item.seen]))).toEqual(
        new Map([
          ['event-early', true],
          ['event-late', true],
        ]),
      );
    });

    it("touches only the acting recipient's watermark", async () => {
      const otherRecipientId = '00000000-0000-4000-8000-000000000002';
      const seenWatermarks = fakeSeenWatermarks();
      const service = createMarkNotificationsSeenService({
        seenWatermarks,
        now: () => new Date('2026-08-02T09:00:00.000Z'),
      });

      await service.markSeen({ actorId: recipientId });

      await expect(seenWatermarks.findSeenWatermarkFor(otherRecipientId)).resolves.toBeNull();
    });
  });
});

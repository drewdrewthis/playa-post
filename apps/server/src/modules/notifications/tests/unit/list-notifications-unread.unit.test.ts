import { describe, expect, it } from 'vitest';

import { viewerIdFromActor, type ViewerId } from '../../../../shared/auth/viewer-id';
import type {
  DeliveredNoteNotification,
  DeliveredNotificationMatch,
  DeliveredNotificationRepository,
} from '../../application/delivered-notification.repository';
import { createDismissNotificationService } from '../../application/dismiss-notification.service';
import { createListNotificationsQuery } from '../../application/list-notifications.query';
import type { NotificationDismissal } from '../../domain/notification-dismissal';
import type {
  DismissNotificationWrite,
  NotificationDismissalRepository,
} from '../../domain/notification-dismissal.repository';
import { NotificationUnavailableError } from '../../domain/notification.errors';

/**
 * `unread`, and the dismissal it is the negation of — the two halves of issue #50's
 * panel state, proven against fakes rather than Postgres.
 *
 * **In-memory fakes, not mocks.** These ports are ours (coding standards: don't mock
 * what you own), and the assertions are about emitted values — which notifications come
 * back marked, and what a second dismissal answers — never about call sequences. SQL
 * correctness is `notification-dismissal.integration.test.ts`'s job; this file is about
 * the rule, and it can state the rule's boundary cases without a container.
 */
describe('notifications unread + dismiss', () => {
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

  /**
   * Everything delivered is visible, which isolates this suite to the dismissal rule and
   * to how the two kinds are shaped: the authorization post-filter has its own scenarios
   * in `notifications-list.integration.test.ts`, against the real `app.visible_bulletins`
   * and `app.visible_notes`.
   */
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

  /** An in-memory `app.notification_dismissals`, primary key and all. */
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

  describe('list', () => {
    it('marks a notification unread while nothing has dismissed it', async () => {
      const query = createListNotificationsQuery({
        deliveredNotifications: fakeDelivered([match('event-1', 'bulletin-1')]),
        dismissals: fakeDismissals(),
      });

      const listed = await query.list({ viewerId });

      expect(listed).toHaveLength(1);
      expect(listed[0]?.unread).toBe(true);
    });

    it('marks a dismissed notification read and KEEPS it in the list', async () => {
      // Keeping it is the design decision. Subtracting would make `unread` a constant,
      // and would leave a client unable to tell "I dismissed this" from "the bulletins
      // behind it stopped being visible to me" — two different facts that both end in a
      // missing row.
      const query = createListNotificationsQuery({
        deliveredNotifications: fakeDelivered([match('event-1', 'bulletin-1')]),
        dismissals: fakeDismissals(['event-1']),
      });

      const listed = await query.list({ viewerId });

      expect(listed).toHaveLength(1);
      expect(listed[0]?.notificationId).toBe('event-1');
      expect(listed[0]?.unread).toBe(false);
    });

    it('dismisses one notification without touching another', async () => {
      const query = createListNotificationsQuery({
        // 61 seconds apart, so the tumbling window puts them in two notifications
        // (M2-AC7) — which is what makes this a test of per-notification state rather
        // than of one group.
        deliveredNotifications: fakeDelivered([
          match('event-1', 'bulletin-1'),
          match('event-2', 'bulletin-2', 61_000),
        ]),
        dismissals: fakeDismissals(['event-2']),
      });

      const listed = await query.list({ viewerId });

      expect(listed).toHaveLength(2);
      expect(new Map(listed.map((item) => [item.notificationId, item.unread]))).toEqual(
        new Map([
          ['event-1', true],
          ['event-2', false],
        ]),
      );
    });

    it('keys the flag on the window opener, the same id the client dismisses by', async () => {
      // Two matches inside one 60-second window are one notification, named after the
      // *first*. A dismissal recorded against the second must not mark it read, or the
      // client's `✕` would silently miss.
      const query = createListNotificationsQuery({
        deliveredNotifications: fakeDelivered([
          match('event-opener', 'bulletin-1'),
          match('event-joiner', 'bulletin-2', 59_000),
        ]),
        dismissals: fakeDismissals(['event-joiner']),
      });

      const listed = await query.list({ viewerId });

      expect(listed).toHaveLength(1);
      expect(listed[0]?.notificationId).toBe('event-opener');
      expect(listed[0]?.unread).toBe(true);
    });

    it('serves both kinds in one list, newest first, each carrying its own discriminator', async () => {
      const query = createListNotificationsQuery({
        deliveredNotifications: fakeDelivered(
          [match('event-bulletin', 'bulletin-1')],
          [note('event-note', 'note-1', 120_000)],
        ),
        dismissals: fakeDismissals(),
      });

      const listed = await query.list({ viewerId });

      expect(listed).toHaveLength(2);
      // The note happened later, so it sorts first — one ordering over both kinds, not
      // two sections a client would have to interleave.
      expect(listed[0]).toEqual({
        kind: 'note',
        notificationId: 'event-note',
        occurredAt: new Date(windowStart.getTime() + 120_000),
        noteId: 'note-1',
        unread: true,
      });
      expect(listed[1]).toEqual({
        kind: 'bulletins',
        notificationId: 'event-bulletin',
        occurredAt: windowStart,
        bulletinIds: ['bulletin-1'],
        unread: true,
      });
    });

    it('never groups two notes, however close together they were pinned', async () => {
      // One second apart — well inside the 60-second window that would have merged two
      // bulletin matches. Two people writing to you is two notifications; collapsing them
      // into "2 notes" would hide the second person.
      const query = createListNotificationsQuery({
        deliveredNotifications: fakeDelivered(
          [],
          [note('event-note-1', 'note-1'), note('event-note-2', 'note-2', 1_000)],
        ),
        dismissals: fakeDismissals(),
      });

      const listed = await query.list({ viewerId });

      expect(listed.map((item) => item.notificationId)).toEqual([
        'event-note-2',
        'event-note-1',
      ]);
    });

    it('marks a dismissed note read and leaves the unread bulletin alone', async () => {
      const query = createListNotificationsQuery({
        deliveredNotifications: fakeDelivered(
          [match('event-bulletin', 'bulletin-1')],
          [note('event-note', 'note-1')],
        ),
        dismissals: fakeDismissals(['event-note']),
      });

      const listed = await query.list({ viewerId });

      expect(new Map(listed.map((item) => [item.notificationId, item.unread]))).toEqual(
        new Map([
          ['event-bulletin', true],
          ['event-note', false],
        ]),
      );
    });
  });

  describe('dismiss', () => {
    it('records the dismissal, so the next list marks it read', async () => {
      const deliveredNotifications = fakeDelivered([match('event-1', 'bulletin-1')]);
      const dismissals = fakeDismissals();
      const service = createDismissNotificationService({
        deliveredNotifications,
        dismissals,
        now: () => new Date('2026-08-02T09:00:00.000Z'),
      });
      const query = createListNotificationsQuery({ deliveredNotifications, dismissals });

      await service.dismiss({ actorId: recipientId, notificationId: 'event-1' });

      expect((await query.list({ viewerId }))[0]?.unread).toBe(false);
    });

    it('dismisses a note notification, so the next list marks it read', async () => {
      // `hasDeliveredMatch` gates every dismissal, so a note the check did not recognise
      // would be refused and the panel's ✕ would silently do nothing on note rows.
      const deliveredNotifications = fakeDelivered([], [note('event-note', 'note-1')]);
      const dismissals = fakeDismissals();
      const service = createDismissNotificationService({
        deliveredNotifications,
        dismissals,
        now: () => new Date('2026-08-02T09:00:00.000Z'),
      });
      const query = createListNotificationsQuery({ deliveredNotifications, dismissals });

      await service.dismiss({ actorId: recipientId, notificationId: 'event-note' });

      expect((await query.list({ viewerId }))[0]?.unread).toBe(false);
    });

    it('answers the moment it was dismissed', async () => {
      const dismissedAt = new Date('2026-08-02T09:00:00.000Z');
      const service = createDismissNotificationService({
        deliveredNotifications: fakeDelivered([match('event-1', 'bulletin-1')]),
        dismissals: fakeDismissals(),
        now: () => dismissedAt,
      });

      await expect(
        service.dismiss({ actorId: recipientId, notificationId: 'event-1' }),
      ).resolves.toEqual({ notificationId: 'event-1', dismissedAt });
    });

    it('is idempotent — a second call answers the FIRST dismissedAt, not a fresh one', async () => {
      // A replay through the offline queue must not make one act look like two.
      const dismissals = fakeDismissals();
      let clock = new Date('2026-08-02T09:00:00.000Z');
      const service = createDismissNotificationService({
        deliveredNotifications: fakeDelivered([match('event-1', 'bulletin-1')]),
        dismissals,
        now: () => clock,
      });

      const first = await service.dismiss({ actorId: recipientId, notificationId: 'event-1' });
      clock = new Date('2026-08-03T09:00:00.000Z');
      const second = await service.dismiss({ actorId: recipientId, notificationId: 'event-1' });

      expect(second.dismissedAt).toEqual(first.dismissedAt);
    });

    it('refuses a notification that is not the actor\'s, with the same answer an invented id gets', async () => {
      // The check is what keeps the table bounded: without it any authenticated caller
      // could write a row for any UUID they made up.
      const service = createDismissNotificationService({
        deliveredNotifications: fakeDelivered([match('event-1', 'bulletin-1')]),
        dismissals: fakeDismissals(),
      });

      await expect(
        service.dismiss({ actorId: recipientId, notificationId: 'event-somebody-elses' }),
      ).rejects.toThrow(NotificationUnavailableError);
      await expect(
        service.dismiss({ actorId: 'a-different-actor', notificationId: 'event-1' }),
      ).rejects.toThrow(NotificationUnavailableError);
    });

    it('writes nothing when it refuses', async () => {
      const dismissals = fakeDismissals();
      const service = createDismissNotificationService({
        deliveredNotifications: fakeDelivered([match('event-1', 'bulletin-1')]),
        dismissals,
      });

      await expect(
        service.dismiss({ actorId: recipientId, notificationId: 'event-invented' }),
      ).rejects.toThrow(NotificationUnavailableError);

      await expect(dismissals.findDismissedFor(recipientId)).resolves.toEqual(new Set());
    });
  });
});

import { describe, expect, it } from 'vitest';

import { viewerIdFromActor, type ViewerId } from '../../../../shared/auth/viewer-id';
import type { LiveConnectionRequestDirectory } from '../../../connections/connections.module';
import type {
  DeliveredConnectionRequestNotification,
  DeliveredNotificationRepository,
} from '../../application/delivered-notification.repository';
import { createListNotificationsQuery } from '../../application/list-notifications.query';
import type { NotificationDismissalRepository } from '../../domain/notification-dismissal.repository';
import type { NotificationSeenWatermarkRepository } from '../../domain/notification-seen-watermark.repository';

/**
 * The connections kind in the list (issue #218), proven against fakes: a delivered
 * request appears only while it is still live in the owner's inbox, and it carries the
 * same `unread`/`seen` state as its two sibling kinds. The liveness answer itself —
 * fourteen days, decided requests gone — belongs to `modules/connections` and is proven
 * against Postgres in its own suites; this file holds only that the list *asks*.
 */
describe('notifications list — connection requests', () => {
  const recipientId = '00000000-0000-4000-8000-000000000001';
  const viewerId: ViewerId = viewerIdFromActor({ userId: recipientId, handle: 'dusty' });
  const windowStart = new Date('2026-08-01T12:00:00.000Z');

  function request(
    eventId: string,
    connectionRequestId: string,
    offsetMs = 0,
  ): DeliveredConnectionRequestNotification {
    return { eventId, connectionRequestId, occurredAt: new Date(windowStart.getTime() + offsetMs) };
  }

  function fakeDelivered(
    requests: readonly DeliveredConnectionRequestNotification[],
  ): DeliveredNotificationRepository {
    return {
      findDeliveredMatches: async () => [],
      findVisibleBulletinIds: async (_viewer, bulletinIds) => bulletinIds,
      findDeliveredNoteNotifications: async () => [],
      findDeliveredConnectionRequestNotifications: async () => requests,
      findVisibleNoteIds: async (_viewer, noteIds) => noteIds,
      hasDeliveredMatch: async (owner, notificationId) =>
        owner === recipientId && requests.some((candidate) => candidate.eventId === notificationId),
    };
  }

  function fakeLiveRequests(liveIds: readonly string[]): LiveConnectionRequestDirectory {
    return { listLiveRequestIdsFor: async () => liveIds };
  }

  function fakeDismissals(seeded: readonly string[] = []): NotificationDismissalRepository {
    return {
      dismiss: async (write) => ({
        notificationId: write.notificationId,
        dismissedAt: write.occurredAt,
      }),
      findDismissedFor: async () => new Set(seeded),
    };
  }

  function fakeNeverSeen(): NotificationSeenWatermarkRepository {
    return {
      markSeen: async (write) => ({ seenAt: write.occurredAt }),
      findSeenWatermarkFor: async () => null,
    };
  }

  it('lists a delivered request that is still live, unread and never grouped', async () => {
    const query = createListNotificationsQuery({
      deliveredNotifications: fakeDelivered([request('event-1', 'request-1')]),
      liveConnectionRequests: fakeLiveRequests(['request-1']),
      dismissals: fakeDismissals(),
      seenWatermarks: fakeNeverSeen(),
    });

    const listed = await query.list({ viewerId });

    expect(listed).toEqual([
      {
        kind: 'connections',
        notificationId: 'event-1',
        occurredAt: new Date(windowStart),
        connectionRequestId: 'request-1',
        unread: true,
        seen: false,
      },
    ]);
  });

  it('drops a delivered request the inbox no longer holds — decided or lapsed', async () => {
    // The delivery-time receipt exists; the read-time answer is "gone". The notification
    // must disappear with the request, or the bell advertises consent that expired.
    const query = createListNotificationsQuery({
      deliveredNotifications: fakeDelivered([request('event-1', 'request-1')]),
      liveConnectionRequests: fakeLiveRequests([]),
      dismissals: fakeDismissals(),
      seenWatermarks: fakeNeverSeen(),
    });

    expect(await query.list({ viewerId })).toHaveLength(0);
  });

  it('keeps a dismissed live request in the list, marked read', async () => {
    const query = createListNotificationsQuery({
      deliveredNotifications: fakeDelivered([request('event-1', 'request-1')]),
      liveConnectionRequests: fakeLiveRequests(['request-1']),
      dismissals: fakeDismissals(['event-1']),
      seenWatermarks: fakeNeverSeen(),
    });

    const listed = await query.list({ viewerId });

    expect(listed).toHaveLength(1);
    expect(listed[0]?.unread).toBe(false);
  });

  it('filters each delivered request by ITS OWN id, not by any-live-request', async () => {
    const query = createListNotificationsQuery({
      deliveredNotifications: fakeDelivered([
        request('event-live', 'request-live'),
        request('event-gone', 'request-gone', 1_000),
      ]),
      liveConnectionRequests: fakeLiveRequests(['request-live']),
      dismissals: fakeDismissals(),
      seenWatermarks: fakeNeverSeen(),
    });

    const listed = await query.list({ viewerId });

    expect(listed.map((notification) => notification.notificationId)).toEqual(['event-live']);
  });
});

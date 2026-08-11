import { describe, expect, it } from 'vitest';

import type { GroupedBulletinNotification, PinnedNoteNotification } from '@playa-post/contracts';

import {
  dismissedNotifications,
  notificationTitle,
  relativeTime,
  unreadNotifications,
  unseenNotificationCount,
} from './notifications-view';

function notification(
  overrides: Partial<GroupedBulletinNotification> = {},
): GroupedBulletinNotification {
  return {
    kind: 'bulletins',
    notificationId: 'n1',
    occurredAt: '2026-08-08T12:00:00.000Z',
    bulletinIds: ['b1'],
    unread: true,
    seen: false,
    ...overrides,
  };
}

function noteNotification(
  overrides: Partial<PinnedNoteNotification> = {},
): PinnedNoteNotification {
  return {
    kind: 'note',
    notificationId: 'n-note',
    occurredAt: '2026-08-08T12:00:00.000Z',
    noteId: 'note-1',
    unread: true,
    seen: false,
    ...overrides,
  };
}

describe('unreadNotifications', () => {
  describe('given a mix of unread and dismissed notifications', () => {
    it('keeps only the unread ones', () => {
      const list = [
        notification({ notificationId: 'n1', unread: true }),
        notification({ notificationId: 'n2', unread: false }),
        notification({ notificationId: 'n3', unread: true }),
      ];

      expect(unreadNotifications(list).map((item) => item.notificationId)).toEqual([
        'n1',
        'n3',
      ]);
    });

    it('preserves the order the server served', () => {
      const list = [
        notification({ notificationId: 'newest', unread: true }),
        notification({ notificationId: 'oldest', unread: true }),
      ];

      expect(unreadNotifications(list).map((item) => item.notificationId)).toEqual([
        'newest',
        'oldest',
      ]);
    });
  });

  describe('given every notification dismissed', () => {
    it('returns nothing, which is what puts the panel on its empty state', () => {
      const list = [
        notification({ notificationId: 'n1', unread: false }),
        notification({ notificationId: 'n2', unread: false }),
      ];

      expect(unreadNotifications(list)).toEqual([]);
    });
  });
});

describe('dismissedNotifications', () => {
  describe('given a mix of unread and dismissed notifications', () => {
    it('keeps only the dismissed ones, so history renders in its own section', () => {
      const list = [
        notification({ notificationId: 'n1', unread: true }),
        notification({ notificationId: 'n2', unread: false }),
      ];

      expect(dismissedNotifications(list).map((item) => item.notificationId)).toEqual([
        'n2',
      ]);
    });
  });
});

describe('unseenNotificationCount', () => {
  describe('given dismissed notifications still in the list', () => {
    it('counts the unread ones rather than the length of the list', () => {
      const list = [
        notification({ notificationId: 'n1', unread: false }),
        notification({ notificationId: 'n2', unread: true }),
        notification({ notificationId: 'n3', unread: false }),
      ];

      expect(unseenNotificationCount(list)).toBe(1);
    });
  });

  describe('given an unread notification the reader has already seen', () => {
    it('does not count it — opening the panel is what clears the badge (issue #178)', () => {
      // The row is still unread and still renders in the panel body. Only the badge
      // stops counting it: the badge answers "has anything happened since you last
      // looked", not "is anything still outstanding".
      expect(unseenNotificationCount([notification({ unread: true, seen: true })])).toBe(0);
    });
  });

  describe('given a notification that arrived after the last panel open', () => {
    it('counts it, so the badge comes back up', () => {
      const list = [
        notification({ notificationId: 'before', unread: true, seen: true }),
        notification({ notificationId: 'after', unread: true, seen: false }),
      ];

      expect(unseenNotificationCount(list)).toBe(1);
    });
  });

  describe('given a dismissed notification that was never seen', () => {
    it('does not count it — dismissing takes it out of the badge too', () => {
      // Both flags gate the badge independently. Dismissing an unseen row (the panel's
      // `✕` before any watermark exists) has to drop the count, or "clear all" would
      // leave a badge nothing on screen explains.
      expect(unseenNotificationCount([notification({ unread: false, seen: false })])).toBe(0);
    });
  });

  describe('given an empty list', () => {
    it('is zero', () => {
      expect(unseenNotificationCount([])).toBe(0);
    });
  });
});

describe('notificationTitle', () => {
  describe('given one grouped bulletin', () => {
    it('reads in the singular', () => {
      expect(notificationTitle(notification({ bulletinIds: ['b1'] }))).toBe(
        'A new bulletin matches your Notify Me query',
      );
    });
  });

  describe('given several grouped bulletins', () => {
    it('names the count and reads in the plural', () => {
      expect(notificationTitle(notification({ bulletinIds: ['b1', 'b2', 'b3'] }))).toBe(
        '3 new bulletins match your Notify Me query',
      );
    });
  });

  describe('given a pinned note', () => {
    it('says a note was pinned, without naming who pinned it', () => {
      // The contract carries no author for a note (§6a decides who a viewer may be told
      // about, on the read that resolves the note), so the copy must not imply one.
      expect(notificationTitle(noteNotification())).toBe(
        'Someone pinned a note to your board',
      );
    });

    it('reads the same for a second note — notes are never counted or grouped', () => {
      // One note is one notification. A "2 notes" line would hide that two different
      // people wrote to this viewer.
      expect(notificationTitle(noteNotification({ notificationId: 'n-note-2' }))).toBe(
        'Someone pinned a note to your board',
      );
    });
  });
});

describe('a mixed list of both kinds', () => {
  it('splits on unread rather than on kind, so notes and bulletins share the panel', () => {
    const list = [
      notification({ notificationId: 'bulletin-unread', unread: true }),
      noteNotification({ notificationId: 'note-dismissed', unread: false }),
      noteNotification({ notificationId: 'note-unread', unread: true }),
    ];

    expect(unreadNotifications(list).map((item) => item.notificationId)).toEqual([
      'bulletin-unread',
      'note-unread',
    ]);
    expect(dismissedNotifications(list).map((item) => item.notificationId)).toEqual([
      'note-dismissed',
    ]);
    expect(unseenNotificationCount(list)).toBe(2);
  });

  it('keeps the panel split on unread alone — seen changes the badge and nothing else', () => {
    // Issue #178's load-bearing separation. Every row here has been seen; the body and
    // the history section must look exactly as they did before the panel was opened,
    // while the badge is empty.
    const list = [
      notification({ notificationId: 'bulletin-unread', unread: true, seen: true }),
      noteNotification({ notificationId: 'note-dismissed', unread: false, seen: true }),
      noteNotification({ notificationId: 'note-unread', unread: true, seen: true }),
    ];

    expect(unreadNotifications(list).map((item) => item.notificationId)).toEqual([
      'bulletin-unread',
      'note-unread',
    ]);
    expect(dismissedNotifications(list).map((item) => item.notificationId)).toEqual([
      'note-dismissed',
    ]);
    expect(unseenNotificationCount(list)).toBe(0);
  });
});

describe('relativeTime', () => {
  const now = new Date('2026-08-08T12:00:00.000Z');

  function ago(milliseconds: number): string {
    return new Date(now.getTime() - milliseconds).toISOString();
  }

  describe('given something that just happened', () => {
    it('says "just now" rather than "0m ago"', () => {
      expect(relativeTime(ago(30_000), now)).toBe('just now');
    });
  });

  describe('given minutes, hours, and days', () => {
    it('renders whole minutes', () => {
      expect(relativeTime(ago(5 * 60_000), now)).toBe('5m ago');
    });

    it('renders whole hours', () => {
      expect(relativeTime(ago(2 * 3_600_000), now)).toBe('2h ago');
    });

    it('renders whole days', () => {
      expect(relativeTime(ago(3 * 86_400_000), now)).toBe('3d ago');
    });
  });

  describe('given a value exactly on a unit boundary', () => {
    it('rolls seconds up to one minute', () => {
      expect(relativeTime(ago(60_000), now)).toBe('1m ago');
    });

    it('rolls minutes up to one hour', () => {
      expect(relativeTime(ago(3_600_000), now)).toBe('1h ago');
    });

    it('rolls hours up to one day', () => {
      expect(relativeTime(ago(86_400_000), now)).toBe('1d ago');
    });
  });

  describe('given a timestamp in the future', () => {
    /*
     * The server stamps `occurredAt` and the browser reads the clock, so a device
     * running slow makes a real notification look like it happened in the future. The
     * only honest answer is the one for "no measurable age" — never "-3m ago".
     */
    it('says "just now" rather than a negative age', () => {
      expect(relativeTime(ago(-3 * 60_000), now)).toBe('just now');
    });
  });

  describe('given an unparseable timestamp', () => {
    it('says "just now" rather than "NaNm ago"', () => {
      expect(relativeTime('not-a-timestamp', now)).toBe('just now');
    });
  });
});

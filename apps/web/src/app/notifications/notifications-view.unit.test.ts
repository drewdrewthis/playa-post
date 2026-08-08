import { describe, expect, it } from 'vitest';

import type { GroupedNotification } from '@playa-post/contracts';

import {
  dismissedNotifications,
  notificationTitle,
  relativeTime,
  unreadNotificationCount,
  unreadNotifications,
} from './notifications-view';

function notification(overrides: Partial<GroupedNotification> = {}): GroupedNotification {
  return {
    notificationId: 'n1',
    occurredAt: '2026-08-08T12:00:00.000Z',
    bulletinIds: ['b1'],
    unread: true,
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

describe('unreadNotificationCount', () => {
  describe('given dismissed notifications still in the list', () => {
    it('counts the unread ones rather than the length of the list', () => {
      const list = [
        notification({ notificationId: 'n1', unread: false }),
        notification({ notificationId: 'n2', unread: true }),
        notification({ notificationId: 'n3', unread: false }),
      ];

      expect(unreadNotificationCount(list)).toBe(1);
    });
  });

  describe('given nothing unread', () => {
    it('is zero, which is what hides the bell badge', () => {
      expect(unreadNotificationCount([notification({ unread: false })])).toBe(0);
    });
  });

  describe('given an empty list', () => {
    it('is zero', () => {
      expect(unreadNotificationCount([])).toBe(0);
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

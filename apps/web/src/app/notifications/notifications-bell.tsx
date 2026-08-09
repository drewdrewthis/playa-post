import type { JSX } from 'react';

import { useGroupedNotifications } from './notifications-query';
import { unreadNotificationCount } from './notifications-view';

/**
 * The bell in the app chrome, with the comp's count badge on its shoulder.
 *
 * ⚠ **The badge counts *unread* notifications, not the length of the list.** A dismissed
 * notification stays in `notifications.list` marked `unread: false` so the panel can keep
 * history; counting the list would mean a badge that never returned to zero once anything
 * had ever arrived.
 *
 * The drawn bell (not the comp's ◔ glyph) is an owner override — see D4 in
 * docs/product/decisions.md. `currentColor` stroke and `em` sizing keep it following
 * `.icon-button`'s ink and font-size like the glyph it replaced.
 */
export function NotificationsBell({
  open,
  onToggle,
}: {
  readonly open: boolean;
  readonly onToggle: () => void;
}): JSX.Element {
  const notifications = useGroupedNotifications(open);
  const unreadCount = unreadNotificationCount(notifications);

  return (
    <button
      className="icon-button"
      data-testid="notifications-bell-button"
      type="button"
      aria-expanded={open}
      aria-label={
        unreadCount === 0
          ? 'Notifications'
          : `Notifications, ${unreadCount} unread`
      }
      onClick={onToggle}
    >
      <svg
        aria-hidden="true"
        width="1.125em"
        height="1.125em"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>

      {unreadCount === 0 ? null : (
        <span className="icon-button__count" data-testid="notifications-unread-count">
          {unreadCount}
        </span>
      )}
    </button>
  );
}

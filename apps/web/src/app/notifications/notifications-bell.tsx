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
      <span aria-hidden="true">◔</span>

      {unreadCount === 0 ? null : (
        <span className="icon-button__count" data-testid="notifications-unread-count">
          {unreadCount}
        </span>
      )}
    </button>
  );
}

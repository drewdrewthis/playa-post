import type { JSX } from 'react';

import { useGroupedNotifications } from './notifications-query';

/**
 * The bell in the app chrome, with the comp's count badge on its shoulder.
 *
 * ⚠ **The badge counts notifications, not *unread* notifications.** `notifications.list`
 * carries no read state — nothing in the contract records that a user looked — so the
 * honest reading of this number is "how many are waiting", which is also exactly what
 * the comp's own badge shows. When a read flag exists, this is the one call site to
 * change.
 */
export function NotificationsBell({
  open,
  onToggle,
}: {
  readonly open: boolean;
  readonly onToggle: () => void;
}): JSX.Element {
  const notifications = useGroupedNotifications(open);

  return (
    <button
      className="icon-button"
      data-testid="notifications-bell-button"
      type="button"
      aria-expanded={open}
      aria-label="Notifications"
      onClick={onToggle}
    >
      <span aria-hidden="true">◔</span>

      {notifications.length === 0 ? null : (
        <span className="icon-button__count" data-testid="notifications-unread-count">
          {notifications.length}
        </span>
      )}
    </button>
  );
}

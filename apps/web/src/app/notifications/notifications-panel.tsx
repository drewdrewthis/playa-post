import { useQuery } from '@tanstack/react-query';
import { useState, type JSX } from 'react';

import { useApi } from '../api/api-provider';

/**
 * The notifications bell and its panel.
 *
 * Reads `notifications.list` — the caller's own grouped Notify Me notifications,
 * newest first — only while the panel is open, and keeps polling while it stays open:
 * the grouping-window flush (ADR-0006) delivers on the server's schedule, not the
 * client's, so a panel opened moments after a matching bulletin would otherwise show
 * "Nothing new" until a remount.
 */
export function NotificationsPanel(): JSX.Element {
  const api = useApi();
  const [open, setOpen] = useState(false);

  const notifications = useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: () => api.query('notifications.list', undefined),
    enabled: open,
    refetchInterval: open ? 1000 : false,
  });

  const items = notifications.data ?? [];

  return (
    <div className="notifications">
      <button
        className="button button--quiet"
        data-testid="notifications-bell-button"
        type="button"
        aria-expanded={open}
        aria-label="Notifications"
        onClick={() => setOpen((previous) => !previous)}
      >
        Notifications
      </button>

      {open ? (
        <div className="notifications__panel" data-testid="notifications-panel" role="region">
          {items.length === 0 ? (
            <p className="notifications__empty">Nothing new.</p>
          ) : (
            <ul className="notifications__list">
              {items.map((notification) => (
                <li
                  key={notification.notificationId}
                  className="notifications__item"
                  data-testid="notification-grouped-item"
                >
                  {notification.bulletinIds.length === 1
                    ? 'A new bulletin matches your Notify Me query'
                    : `${notification.bulletinIds.length} new bulletins match your Notify Me query`}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

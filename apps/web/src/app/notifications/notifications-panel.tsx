import { useState, type JSX } from 'react';

import type { GroupedNotification } from '@playa-post/contracts';

/**
 * The notifications bell and its panel.
 *
 * ⚠ **M2 ships the surface with no source behind it, and that is stated rather than
 * faked.** `modules/notifications` has a grouped-push *writer* (`sendGroupedPush`,
 * driven by the flush scheduler) and **no reader**: there is no procedure on the
 * router that returns a viewer's notifications, so `PlayaPostApi` has no key to call
 * and this panel has nothing to render. The component takes its items as a prop so
 * that the read procedure L3b-notify still owes plugs in at one call site — see the L5
 * PR body's "step 9" note for the defect this is waiting on.
 *
 * Deriving the list client-side instead — "recent board items", say — would render a
 * `notification-grouped-item` that has nothing to do with a Notify Me query, and a
 * green assertion over the wrong thing is worse than a red one over the right thing.
 */
export function NotificationsPanel({
  notifications = [],
}: {
  readonly notifications?: readonly GroupedNotification[];
}): JSX.Element {
  const [open, setOpen] = useState(false);

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
          {notifications.length === 0 ? (
            <p className="notifications__empty">Nothing new.</p>
          ) : (
            <ul className="notifications__list">
              {notifications.map((notification) => (
                <li
                  key={notification.bulletinIds.join(',')}
                  className="notifications__item"
                  data-testid="notification-grouped-item"
                >
                  {notification.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

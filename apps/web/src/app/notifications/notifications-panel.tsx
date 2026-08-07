import type { JSX } from 'react';

import { useGroupedNotifications } from './notifications-query';

/**
 * Notifications, as the comp draws them: a full takeover of the column rather than a
 * dropdown.
 *
 * A dropdown puts a scrolling list inside a 38px button's shadow on a 390px-wide phone.
 * The comp's answer is a screen with its own back chevron, and it is the right one —
 * these items are things to read and act on, not a menu.
 *
 * Rendered by the shell as a sibling of the tab bar, so `inset: 0` resolves against the
 * app column and the overlay covers the tabs too.
 */
export function NotificationsPanel({ onClose }: { readonly onClose: () => void }): JSX.Element {
  const notifications = useGroupedNotifications(true);

  return (
    <section
      className="notifications"
      data-testid="notifications-panel"
      role="region"
      aria-label="Notifications"
    >
      <header className="notifications__header">
        <button
          className="notifications__back"
          type="button"
          aria-label="Close notifications"
          onClick={onClose}
        >
          <span aria-hidden="true">‹</span>
        </button>
        <h2 className="notifications__title">Notifications</h2>
      </header>

      <div className="notifications__body">
        {notifications.length === 0 ? (
          <p className="screen__empty">All quiet. The dust settles.</p>
        ) : (
          <>
            <p className="screen__aside">
              Everything that landed on your board or changed your graph.
            </p>

            <ul className="notifications__list">
              {notifications.map((notification) => (
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
          </>
        )}
      </div>
    </section>
  );
}

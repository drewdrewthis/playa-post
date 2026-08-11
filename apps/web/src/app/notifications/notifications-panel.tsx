import type { JSX } from 'react';
import { Link } from 'react-router';

import type { GroupedNotification } from '@playa-post/contracts';

import { EnablePushControl } from './enable-push-control';
import { useMarkNotificationsSeen, useNotificationDismissal } from './notifications-mutation';
import { useGroupedNotifications } from './notifications-query';
import {
  dismissedNotifications,
  notificationTitle,
  relativeTime,
  unreadNotifications,
} from './notifications-view';

import './notifications-panel.css';

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
 *
 * ⚠ **The body is the *unread* notifications, not the list.** `notifications.list`
 * keeps a dismissed notification and marks it, so the panel splits: what is still
 * waiting, then what has been dealt with. Rendering the list whole would mean nothing
 * ever left the screen.
 *
 * ⚠ **Opening this screen clears the bell's badge and moves nothing** (issue #178).
 * `useMarkNotificationsSeen` below records that the panel was open; the badge then counts only what
 * arrives after. It changes **nothing on this screen** — the split above is still on
 * `unread`, so every row the reader came to deal with is exactly where it was. Being
 * looked at is not being dealt with, and the `✕` is still the only thing that moves a row
 * into Dismissed.
 */
export function NotificationsPanel({ onClose }: { readonly onClose: () => void }): JSX.Element {
  const notifications = useGroupedNotifications(true);
  const dismissal = useNotificationDismissal();

  // Mounted only while the panel is open (see `app-shell.tsx`), so this is once per
  // opening — which is what makes anything arriving between two openings count as new.
  useMarkNotificationsSeen();

  const unread = unreadNotifications(notifications);
  const dismissed = dismissedNotifications(notifications);

  // Read once per render rather than on a timer: the list polls while the panel is
  // open, and these ages are hours old — a ticking clock would buy nothing visible.
  const now = new Date();

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

        {unread.length === 0 ? null : (
          <button
            className="notifications__clear-all"
            data-testid="notifications-clear-all"
            type="button"
            disabled={dismissal.pending}
            onClick={() => {
              dismissal.dismiss(unread.map((notification) => notification.notificationId));
            }}
          >
            Clear all
          </button>
        )}
      </header>

      <div className="notifications__body">
        <p className="screen__aside">
          Everything that landed on your board or changed your graph. Open one to find it
          on your board.
        </p>

        {/*
          Above the list rather than below it: this is the panel's one offer, and a
          reader with a full list would never scroll past it. It renders nothing at all
          on a device or build that cannot do push — see `enable-push-control.tsx`.
        */}
        <EnablePushControl />

        {dismissal.refusedCount === 0 ? null : (
          <p className="notifications__refused" role="status" data-testid="notifications-refused">
            {dismissal.refusedCount === 1
              ? 'One notification could not be cleared — it is no longer available.'
              : `${dismissal.refusedCount} notifications could not be cleared — they are no longer available.`}
          </p>
        )}

        {unread.length === 0 ? (
          <p className="screen__empty">All quiet. The dust settles.</p>
        ) : (
          <ul className="notifications__list">
            {unread.map((notification) => (
              <NotificationRow
                key={notification.notificationId}
                notification={notification}
                now={now}
                onOpen={onClose}
                onDismiss={() => {
                  dismissal.dismiss([notification.notificationId]);
                }}
                dismissing={dismissal.pending}
              />
            ))}
          </ul>
        )}

        {dismissed.length === 0 ? null : (
          <section className="notifications__section" data-testid="notifications-dismissed">
            <h3 className="notifications__section-label">Dismissed</h3>

            <ul className="notifications__list">
              {dismissed.map((notification) => (
                <NotificationRow
                  key={notification.notificationId}
                  notification={notification}
                  now={now}
                  onOpen={onClose}
                />
              ))}
            </ul>
          </section>
        )}
      </div>
    </section>
  );
}

/**
 * One row: the comp's serif title, its meta line, and its two affordances.
 *
 * The `→` opens the board rather than the bulletin that caused the notification. The
 * contract serves ids and no deep link exists for a single bulletin yet, and "the board,
 * where these are" is true — a link that claimed to open one specific item and did not
 * would be worse than an honest one.
 *
 * A dismissed row is given no `✕`: there is nothing left to dismiss, and a control whose
 * only outcome is an idempotent no-op is a control that teaches nothing.
 *
 * @param now - the reading clock, so every row on a render agrees about "ago".
 * @param onOpen - run alongside the navigation; the panel closes behind the reader.
 * @param onDismiss - omitted for a row that is already dismissed.
 * @param dismissing - true while any dismissal is in flight.
 */
function NotificationRow({
  notification,
  now,
  onOpen,
  onDismiss,
  dismissing = false,
}: {
  readonly notification: GroupedNotification;
  readonly now: Date;
  readonly onOpen: () => void;
  readonly onDismiss?: () => void;
  readonly dismissing?: boolean;
}): JSX.Element {
  const title = notificationTitle(notification);

  return (
    <li
      className="notifications__item notification-row"
      data-testid="notification-grouped-item"
      data-unread={notification.unread}
    >
      {notification.unread ? (
        <span className="notification-row__mark" aria-hidden="true" />
      ) : null}

      <Link className="notification-row__open" to="/board" onClick={onOpen}>
        <span className="notification-row__content">
          <span className="notification-row__title">{title}</span>
          <span className="notification-row__meta">
            {notification.unread ? 'new on your board' : 'on your board'} ·{' '}
            <time dateTime={notification.occurredAt}>
              {relativeTime(notification.occurredAt, now)}
            </time>
          </span>
        </span>

        <span className="notification-row__go" aria-hidden="true">
          →
        </span>
      </Link>

      {onDismiss === undefined ? null : (
        <button
          className="notification-row__dismiss"
          data-testid="notification-dismiss-button"
          type="button"
          aria-label={`Dismiss: ${title}`}
          disabled={dismissing}
          onClick={onDismiss}
        >
          <span aria-hidden="true">✕</span>
        </button>
      )}
    </li>
  );
}

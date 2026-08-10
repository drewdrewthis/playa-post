import type { GroupedNotification } from '../application/grouped-notification';
import type { NotificationDismissal } from '../domain/notification-dismissal';

/** What every notification on the wire carries, whatever caused it. */
interface PresentedNotificationBase {
  readonly notificationId: string;
  readonly occurredAt: string;
  /** `false` once this recipient has dismissed it. The badge counts the `true`s. */
  readonly unread: boolean;
}

/** A Notify Me window's worth of bulletins, on the wire. */
export interface PresentedBulletinNotification extends PresentedNotificationBase {
  readonly kind: 'bulletins';
  readonly bulletinIds: readonly string[];
}

/** A note somebody pinned to this viewer's board, on the wire. Identifier only. */
export interface PresentedNoteNotification extends PresentedNotificationBase {
  readonly kind: 'note';
  readonly noteId: string;
}

/**
 * One notification as this API renders it.
 *
 * The same shape as the {@link GroupedNotification} read model, restated rather than
 * re-exported: the wire is a contract and the read model is an implementation, so a
 * change made for the server's convenience must not become a silent break in the
 * client's API. `packages/contracts` publishes the client-facing key separately (lane
 * L5) and this is what it describes.
 *
 * Timestamps are ISO-8601 strings rather than `Date`s, matching `bulletin.presenter.ts`:
 * tRPC without a serializer turns a `Date` into a string on the wire anyway, so
 * declaring the string is declaring what a caller actually receives.
 */
export type PresentedNotification = PresentedBulletinNotification | PresentedNoteNotification;

/**
 * What comes back when a recipient dismisses a notification.
 *
 * Two fields and no echo of the notification's contents: the caller already has them,
 * and a mutation that answered with a payload would invite a client to render from the
 * response instead of refetching the list the dismissal just changed.
 */
export interface PresentedNotificationDismissal {
  readonly notificationId: string;
  /** ISO-8601. Unchanged by a repeated dismissal — the first one is the answer. */
  readonly dismissedAt: string;
}

/**
 * Project one notification onto the wire.
 *
 * A field-by-field copy rather than a spread: a spread would carry whatever the read
 * model grows next into every client payload without anyone deciding it should be there,
 * and "the field appeared in the response because someone added it upstream" is exactly
 * how M2-AC5's "no author name, handle, or avatar … in notifications" gets violated by
 * accident. That is also why the two kinds are written out separately rather than
 * copied through a shared base and then extended — each wire shape is stated in full,
 * once, where a reviewer can see every field it can possibly carry.
 */
export function presentNotification(notification: GroupedNotification): PresentedNotification {
  return notification.kind === 'note'
    ? {
        kind: 'note',
        notificationId: notification.notificationId,
        occurredAt: notification.occurredAt.toISOString(),
        // ⚠ The note's identifier and nothing else. No body and no author: the client
        // reads the note through `notes.*`, which is where visibility and §6a projection
        // are applied.
        noteId: notification.noteId,
        unread: notification.unread,
      }
    : {
        kind: 'bulletins',
        notificationId: notification.notificationId,
        occurredAt: notification.occurredAt.toISOString(),
        bulletinIds: [...notification.bulletinIds],
        unread: notification.unread,
      };
}

/** Project one dismissal onto the wire. */
export function presentNotificationDismissal(
  dismissal: NotificationDismissal,
): PresentedNotificationDismissal {
  return {
    notificationId: dismissal.notificationId,
    dismissedAt: dismissal.dismissedAt.toISOString(),
  };
}

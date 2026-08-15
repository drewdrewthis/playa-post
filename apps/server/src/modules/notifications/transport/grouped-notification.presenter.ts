import type { GroupedNotification } from '../application/grouped-notification';
import type { NotificationSetting } from '../application/notification-settings.service';
import type { NotificationDismissal } from '../domain/notification-dismissal';
import type { NotificationKind } from '../domain/notification-kind';
import type { NotificationSeenMark } from '../domain/notification-seen-mark';

/** What every notification on the wire carries, whatever caused it. */
interface PresentedNotificationBase {
  readonly notificationId: string;
  readonly occurredAt: string;
  /** `false` once this recipient has dismissed it. The panel's sections split on it. */
  readonly unread: boolean;
  /**
   * `true` once this notification was already on the list the last time the recipient
   * opened their panel. **The badge counts `unread && !seen`** — see
   * {@link import('../application/grouped-notification').GroupedNotification.seen} for why
   * the two flags are independent.
   */
  readonly seen: boolean;
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

/** A pending request to connect, on the wire. Identifier only — no requester, no slug. */
export interface PresentedConnectionRequestNotification extends PresentedNotificationBase {
  readonly kind: 'connections';
  readonly connectionRequestId: string;
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
export type PresentedNotification =
  | PresentedBulletinNotification
  | PresentedNoteNotification
  | PresentedConnectionRequestNotification;

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
 * What comes back when a recipient's panel is marked seen.
 *
 * One field and no echo of the list: `markSeen` names no notification and the caller is
 * about to refetch `list` anyway, so a payload here would only invite a client to render
 * from a response that describes a moment rather than a state.
 */
export interface PresentedNotificationSeenMark {
  /**
   * ISO-8601. **Advanced by every call**, unlike a dismissal's `dismissedAt` — see
   * {@link import('../domain/notification-seen-mark').NotificationSeenMark.seenAt}.
   */
  readonly seenAt: string;
}

/**
 * What `notifications.settings.get` and `.update` answer with (issue #209).
 *
 * The full list, one entry per kind in `NOTIFICATION_KINDS` order, so a client renders
 * the settings panel from the response and never hardcodes kinds. `enabled` is derived
 * server-side from the absence of an opt-out row (ADR-0020 D3).
 */
export interface PresentedNotificationSettings {
  readonly settings: readonly { readonly kind: NotificationKind; readonly enabled: boolean }[];
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
  switch (notification.kind) {
    case 'note':
      return {
        kind: 'note',
        notificationId: notification.notificationId,
        occurredAt: notification.occurredAt.toISOString(),
        // ⚠ The note's identifier and nothing else. No body and no author: the client
        // reads the note through `notes.*`, which is where visibility and §6a projection
        // are applied.
        noteId: notification.noteId,
        unread: notification.unread,
        seen: notification.seen,
      };
    case 'connections':
      return {
        kind: 'connections',
        notificationId: notification.notificationId,
        occurredAt: notification.occurredAt.toISOString(),
        // ⚠ The request's identifier and nothing else. Who asked is read through the
        // inbox on `connections.requests.list`, which is where the requester's
        // self-projection and the TTL are applied.
        connectionRequestId: notification.connectionRequestId,
        unread: notification.unread,
        seen: notification.seen,
      };
    case 'bulletins':
      return {
        kind: 'bulletins',
        notificationId: notification.notificationId,
        occurredAt: notification.occurredAt.toISOString(),
        bulletinIds: [...notification.bulletinIds],
        unread: notification.unread,
        seen: notification.seen,
      };
  }
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

/** Project the caller's settings onto the wire. Field-by-field, like every presenter here. */
export function presentNotificationSettings(
  settings: readonly NotificationSetting[],
): PresentedNotificationSettings {
  return {
    settings: settings.map((setting) => ({ kind: setting.kind, enabled: setting.enabled })),
  };
}

/** Project one seen watermark onto the wire. */
export function presentNotificationSeenMark(
  mark: NotificationSeenMark,
): PresentedNotificationSeenMark {
  return {
    seenAt: mark.seenAt.toISOString(),
  };
}

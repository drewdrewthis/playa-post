import type { ViewerId } from '../../../shared/auth/viewer-id';
import type { GroupableMatch } from '../domain/notification-window';

/**
 * One match the grouped-push flush has already claimed.
 *
 * {@link import('../domain/notify-me-match').NotifyMeMatch} minus `authorId`, and the
 * subtraction is the point: the delivery path re-checks whether a bulletin's *author* is
 * still visible because it holds no bulletin to check (ADR-0002 §11), whereas this path
 * re-checks the *bulletin itself* through `app.visible_bulletins`. Carrying an
 * identifier no caller reads would only invite one to start reading it.
 */
export interface DeliveredNotificationMatch extends GroupableMatch {
  /** `app.outbox_events.event_id` of the `NotifyMeMatched` row. */
  readonly eventId: string;
  readonly bulletinId: string;
}

/**
 * The port onto notifications a viewer may read.
 *
 * Separate from
 * {@link import('./notify-me-match.repository').NotifyMeMatchRepository} rather than two
 * more methods on it: that port is the delivery ledger — it claims windows, writes
 * receipts and runs dispatch inside a transaction — and a read procedure that depended
 * on it would depend on every one of those. Two interfaces over one table, one of them
 * read-only, is the smaller thing to reason about at the boundary that faces a client.
 *
 * Declared in `application/` for the same reason its sibling is: these are queries over
 * a shared delivery ledger, not an aggregate this module reconstructs.
 */
export interface DeliveredNotificationRepository {
  /**
   * Every match whose window this viewer has already been flushed.
   *
   * "Flushed" is read from the `SendGroupedPushHandler` receipt, not from
   * `app.outbox_events.status`: ADR-0006 makes the receipt *the* record that a consumer
   * processed an event, and it is written in the same transaction as the status flip, so
   * asserting on both would be two conditions that can only ever drift.
   *
   * A match still awaiting its flush is deliberately absent — its window has not closed,
   * so no notification exists yet for it to belong to.
   *
   * @param viewerId - A {@link ViewerId}, never a `string`. ADR-0002 §5a: the
   *   catastrophic bug in this architecture is not a missing `WHERE`, it is a viewer
   *   identifier that arrived from request input.
   * @returns Oldest first, so the grouper reads a window rather than a batch.
   */
  findDeliveredMatches(viewerId: ViewerId): Promise<readonly DeliveredNotificationMatch[]>;

  /**
   * Of `bulletinIds`, the ones this viewer may **still** see.
   *
   * Asked through `app.visible_bulletins` — the one definition of what a viewer may see
   * (ADR-0002 §6) — because a notification is disclosed when it is read, not when it was
   * computed, and the authorization that mattered at flush time may be gone by now
   * (ADR-0002 §11's race, on the read path).
   *
   * @returns A subset of `bulletinIds`, in no guaranteed order. Empty when none survive.
   */
  findVisibleBulletinIds(
    viewerId: ViewerId,
    bulletinIds: readonly string[],
  ): Promise<readonly string[]>;

  /**
   * Whether `notificationId` names a flushed match belonging to this recipient.
   *
   * The pre-write check behind `notifications.dismiss` — see
   * {@link import('../domain/notification.errors').NotificationUnavailableError} for why
   * dismissing without one is an unbounded write surface.
   *
   * ⚠ **It answers "is this the caller's own delivered match", not "is this a window
   * opener".** Proving the latter would mean regrouping the caller's whole history on
   * every dismissal, to refuse a case whose worst outcome is a dismissal row that
   * matches no notification — a harmless orphan, indistinguishable from one whose window
   * has since aged out. The check that is cheap is the one that closes the abuse
   * surface; the one that is expensive buys tidiness.
   *
   * @param recipientId - An `app.users.id` from the resolved actor. Taken as a `string`
   *   rather than a {@link ViewerId} because the write path's command carries the actor
   *   the way every other module's does — and because it is a `WHERE` on the caller's
   *   own rows, not a viewer-scoped visibility read.
   */
  hasDeliveredMatch(recipientId: string, notificationId: string): Promise<boolean>;
}

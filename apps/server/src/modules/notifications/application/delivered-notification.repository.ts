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
 * One pinned note this recipient has already been notified about.
 *
 * ⚠ **Deliberately not a {@link GroupableMatch}.** A note is one event for one named
 * recipient, so there is no window to group it into and no `recipientId` for a grouper
 * to key on — the read already filtered on the viewer. Giving it the grouping shape
 * would invite somebody to run it through
 * {@link import('../domain/notification-window').groupIntoNotificationWindows} and
 * quietly collapse two separate notes into "2 notes", which is a thing nobody decided.
 *
 * No body, no author: the payload it is read from carries neither, and the listing
 * serves identifiers only (M2-AC5's rule, applied to a channel whose content is the most
 * private thing this product stores).
 */
export interface DeliveredNoteNotification {
  /** `app.outbox_events.event_id` of the `NotePinned` row. The notification's id. */
  readonly eventId: string;
  readonly noteId: string;
  /** When the note was pinned, not when it was delivered. */
  readonly occurredAt: Date;
}

/**
 * One connection request this owner has already been notified about (issue #218).
 *
 * The exact shape of {@link DeliveredNoteNotification}, for the same reasons: not a
 * {@link GroupableMatch} — one request is one person asking, so there is no window —
 * and identifiers only: no requester, no slug.
 */
export interface DeliveredConnectionRequestNotification {
  /** `app.outbox_events.event_id` of the `ConnectionRequested` row. The notification's id. */
  readonly eventId: string;
  readonly connectionRequestId: string;
  /** When the request was sent, not when it was delivered. */
  readonly occurredAt: Date;
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
   * Every note this viewer has already been notified about.
   *
   * "Notified" is read from the
   * {@link import('./deliver-note-pinned.handler').DeliverNotePinnedHandler} receipt, for
   * the reason its bulletin sibling reads the flush receipt: ADR-0006 makes the receipt
   * *the* record that a consumer processed an event, so a `NotePinned` row the drainer
   * has not yet delivered is not a notification and does not appear.
   *
   * ⚠ **Not merged into {@link findDeliveredMatches}.** The two answer different
   * questions — one produces windows to be grouped, the other singletons that must not
   * be — and a union that returned both would have to carry a discriminator down through
   * the grouper to keep them apart. The application layer is where the two kinds meet.
   *
   * @param viewerId - A {@link ViewerId}, never a `string` (ADR-0002 §5a).
   * @returns Oldest first, matching its sibling so the caller sorts once.
   */
  findDeliveredNoteNotifications(viewerId: ViewerId): Promise<readonly DeliveredNoteNotification[]>;

  /**
   * Of `noteIds`, the ones this viewer may **still** read.
   *
   * Asked through `app.visible_notes` — the one definition of which notes a viewer may
   * read (ADR-0002 §6) — for the reason {@link findVisibleBulletinIds} asks
   * `app.visible_bulletins`: a notification is disclosed when it is read, not when it was
   * delivered.
   *
   * ⚠ **Only the identifier crosses this boundary.** `app.visible_notes` returns the
   * note's `body`, and nothing in the notifications module may select it: the bell says a
   * note arrived and the note channel is where it is read.
   *
   * @returns A subset of `noteIds`, in no guaranteed order. Empty when none survive.
   */
  findVisibleNoteIds(viewerId: ViewerId, noteIds: readonly string[]): Promise<readonly string[]>;

  /**
   * Every connection request this viewer has already been notified about (issue #218).
   *
   * "Notified" is read from the
   * {@link import('./deliver-connection-requested.handler').DeliverConnectionRequestedHandler}
   * receipt, exactly as {@link findDeliveredNoteNotifications} reads its consumer's.
   *
   * ⚠ **Delivered, not necessarily still live.** Whether the request is still in the
   * owner's inbox — pending, unlapsed — is `modules/connections`' question, answered
   * through its exported directory at the application layer; this read reports only
   * what the consumer delivered.
   *
   * @param viewerId - A {@link ViewerId}, never a `string` (ADR-0002 §5a).
   * @returns Oldest first, matching its siblings so the caller sorts once.
   */
  findDeliveredConnectionRequestNotifications(
    viewerId: ViewerId,
  ): Promise<readonly DeliveredConnectionRequestNotification[]>;

  /**
   * Whether `notificationId` names a delivered notification belonging to this recipient
   * — a flushed `NotifyMeMatched` match, a `NotePinned` note addressed to them, or a
   * `ConnectionRequested` request aimed at them.
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
   * surface; the one that is expensive buys tidiness. A note notification has no window,
   * so for that kind the two questions are the same one.
   *
   * @param recipientId - An `app.users.id` from the resolved actor. Taken as a `string`
   *   rather than a {@link ViewerId} because the write path's command carries the actor
   *   the way every other module's does — and because it is a `WHERE` on the caller's
   *   own rows, not a viewer-scoped visibility read.
   */
  hasDeliveredMatch(recipientId: string, notificationId: string): Promise<boolean>;
}

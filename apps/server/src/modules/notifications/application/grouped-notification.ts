/**
 * What every notification carries, whatever caused it.
 *
 * **Identifiers and a timestamp, and nothing else.** M2-AC5 forbids an author name,
 * handle or avatar "in notifications" and M2-AC10 forbids any response containing a
 * hidden person's identifier "across bulletin read, notifications, and A's own bulletin
 * list". Satisfying both by *carrying no such field* is stronger than satisfying them by
 * redacting one: there is nothing here for a future edit to forget to redact, and the
 * client's follow-up read through `bulletins.*` or `notes.*` is where §6a author
 * projection already happens.
 */
interface NotificationBase {
  /**
   * Stable key for this notification, and the id a dismissal names.
   *
   * An opaque identifier a client can key a list by. It is not a row in a notifications
   * table, because there is none: ADR-0006 makes the outbox row plus its consumer receipt
   * the record that a notification happened, and M5 ("delivery records subsystem") is
   * where a durable notification row would be introduced if one is ever needed.
   */
  readonly notificationId: string;
  /**
   * When the thing happened — the bulletin's or the note's own `occurred_at`.
   *
   * Not when it was delivered: a person reads "what happened", and two notifications
   * produced by the same drain or the same flush are two moments, not one.
   */
  readonly occurredAt: Date;
  /**
   * `false` once this recipient has dismissed it; `true` until then.
   *
   * **Derived from the absence of a dismissal, not stored.** There is one durable fact —
   * the dismissal — and this is its negation, so "unread" and "dismissed" can never
   * disagree the way two columns eventually would.
   *
   * ⚠ **A dismissed notification stays in the list.** Two reasons, and the second is the
   * load-bearing one. The badge counts unread while the panel can still show history, so
   * one read serves both. And a dismissal stays *observable*: a client confirms the
   * write landed by seeing the item return with `unread: false`, rather than inferring
   * it from an absence — which would be ambiguous here, because a notification also
   * disappears when what it points at stops being visible (ADR-0002 §11's read-time
   * re-check). Subtracting instead would also make this field a constant, which is the
   * shape `modules/bulletins`' `VisibleBulletin` refuses `archivedAt` for.
   *
   * Growth is bounded by ADR-0006's fourteen-day outbox retention, the same bound that
   * lets this read take no page size.
   */
  readonly unread: boolean;
  /**
   * `true` once this notification was already on the list the last time the viewer
   * opened their panel (issue #178).
   *
   * **Derived from one durable per-viewer watermark, not stored per notification**: the
   * same discipline {@link unread} follows, and for a stronger reason. There is one fact
   * — the moment `app.notification_seen_watermarks` records — and every notification's
   * `seen` is `occurredAt <= lastSeenAt` against it, inclusive. A per-row flag would be
   * O(history) to write on the most-repeated gesture in the product, and would have to be
   * written from a list the client sent — silently marking seen whatever arrived between
   * that client's read and its write.
   *
   * ⚠ **A different question from {@link unread}, and the two must stay independent.**
   * Seen is "has anything happened since you last looked" and is what the bell's badge
   * counts; unread is "have you dealt with this" and is what the panel's sections split
   * on. All four combinations are reachable and meaningful: an unread notification the
   * viewer has seen still renders in the panel body with the badge at zero, and a
   * dismissed one that arrived after the last open is out of the body and out of the
   * count. Deriving either from the other collapses a distinction the whole feature
   * exists to keep.
   *
   * ⚠ **Compared against the *served* `occurredAt`**, which for a grouped notification is
   * its opening match's. Comparing a joiner's timestamp instead would leave a group
   * unseen whose visible time is older than the watermark — a badge counting a row the
   * reader is looking at.
   *
   * `false` for a viewer who has never opened their panel: never having looked is a real
   * state, and it is the one where the badge shows everything.
   */
  readonly seen: boolean;
}

/** One Notify Me notification — a closed 60-second window's worth of bulletins. */
export interface GroupedBulletinNotification extends NotificationBase {
  readonly kind: 'bulletins';
  /**
   * The bulletins in this group, de-duplicated, and only those the viewer may still see.
   *
   * Never empty — a group with nothing left to show is dropped rather than reported as
   * an empty notification.
   */
  readonly bulletinIds: readonly string[];
}

/**
 * One note somebody pinned to this viewer's board (issue #149).
 *
 * ⚠ **A singleton, never a window.** Grouping exists because a saved query can match an
 * unbounded number of bulletins at once; a note is one deliberate act aimed at one
 * person, and collapsing two into "2 notes" would hide that two people wrote to them.
 *
 * ⚠ **`noteId` and nothing more — never the body, never the author.** A note is the most
 * private thing this product stores. The bell says one arrived; reading it is a separate,
 * visibility-checked call through `notes.*`, which is also where §6a decides whether the
 * viewer may be told who wrote it.
 */
export interface PinnedNoteNotification extends NotificationBase {
  readonly kind: 'note';
  readonly noteId: string;
}

/**
 * One connection request aimed at this viewer (issue #218).
 *
 * ⚠ **A singleton, never a window**, for the note's reason: a request is one deliberate
 * act by one person, and "2 connection requests" would hide that two people asked.
 *
 * ⚠ **`connectionRequestId` and nothing more — never the requester.** Who asked is
 * answered by the request inbox (`connections.requests.list`), where §6a projects the
 * requester card at read time. A notification that named the requester would freeze an
 * identity the graph may since have withdrawn.
 */
export interface ConnectionRequestNotification extends NotificationBase {
  readonly kind: 'connections';
  readonly connectionRequestId: string;
}

/**
 * One notification as a viewer reads it.
 *
 * **A discriminated union rather than one shape with optional fields**: `bulletinIds` and
 * `noteId` are never both meaningful, and a client that must branch to render a title
 * should be made to branch by the type rather than by a runtime guess about which field
 * arrived. It also keeps "a bulletin group is never empty" and "a note always names one
 * note" as facts the compiler holds, instead of invariants a presenter has to defend.
 */
export type GroupedNotification =
  | GroupedBulletinNotification
  | PinnedNoteNotification
  | ConnectionRequestNotification;

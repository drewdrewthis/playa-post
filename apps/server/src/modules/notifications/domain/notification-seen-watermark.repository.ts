import type { NotificationSeenMark } from './notification-seen-mark';

/** What marking seen is given. The recipient is the resolved actor, never request input. */
export interface MarkNotificationsSeenWrite {
  /**
   * Whose panel was open. Taken from the `Actor`, so a caller cannot clear somebody
   * else's badge — or, worse, *raise* one by moving a stranger's watermark backwards.
   */
  readonly recipientId: string;
  /** The moment the panel was open. The application layer reads the clock, not this port. */
  readonly occurredAt: Date;
}

/**
 * The port onto `app.notification_seen_watermarks`.
 *
 * **Two methods, one write and one read, and no `clearSeen`.** Un-seeing is not a product
 * affordance: the badge means "something happened since you last looked", and there is no
 * gesture in the comp that makes that untrue about a moment which has already passed. A
 * reset method existing "for symmetry" is a mutation somebody eventually exposes, and the
 * one it would expose can only make a badge lie.
 *
 * ⚠ **The write is monotonic, and that is this port's contract rather than the caller's.**
 * {@link markSeen} never moves the watermark backwards: two devices with disagreeing
 * clocks, or a retry that arrives out of order, must not un-see notifications a person has
 * already been shown. Pushing that rule down here means there is one place it can be got
 * wrong instead of one per caller.
 *
 * ⚠ **Nothing here writes `app.outbox_events`**, the same decision — and for the same
 * reason — as
 * {@link import('./notification-dismissal.repository').NotificationDismissalRepository}:
 * the outbox exists so a state change and the work that reacts to it commit together
 * (ADR-0006, addendum §10), and opening a panel has no reactor. Nothing re-reads the
 * watermark but this module's own list, no push is sent, no other module's state depends
 * on it, and an audit entry would durably record every time a person glanced at their own
 * bell — a far noisier privacy footprint than the dismissal this module already declined
 * to publish. If a second device ever needs to converge on it, that is a sync-envelope
 * mutation type, not an event.
 */
export interface NotificationSeenWatermarkRepository {
  /**
   * Record that this recipient had their panel open at {@link MarkNotificationsSeenWrite.occurredAt}.
   *
   * @returns The watermark as it now stands — which is the **later** of the stored moment
   *   and the one written, so a caller can always trust the answer describes the row.
   */
  markSeen(write: MarkNotificationsSeenWrite): Promise<NotificationSeenMark>;

  /**
   * When this recipient last opened their panel, or `null` if they never have.
   *
   * `null` rather than a beginning-of-time sentinel: "has never looked" is a real state
   * with a real consequence — every notification is unseen and the badge shows the lot —
   * and a sentinel would make the read path unable to tell it from a watermark somebody
   * genuinely set in 1970.
   *
   * @param recipientId - An `app.users.id`. From the resolved actor on the read path;
   *   this port takes a `string` the way every application-layer command does.
   */
  findSeenWatermarkFor(recipientId: string): Promise<Date | null>;
}

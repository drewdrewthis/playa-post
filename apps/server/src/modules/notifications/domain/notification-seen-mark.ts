/**
 * The moment a recipient's notifications panel was last open (issue #178).
 *
 * The whole of this module's second piece of per-viewer state, and deliberately a
 * *moment* rather than a set: "everything up to here has been seen" needs no list of
 * identifiers, so it cannot race a read the way marking rows a client happened to be
 * holding would.
 *
 * ⚠ **Not the same fact as a {@link import('./notification-dismissal').NotificationDismissal}
 * and never derived from one.** Seen answers "has anything happened since you last
 * looked" — it is what the bell's badge counts. Dismissed answers "have you dealt with
 * this one" — it is what the panel's sections split on. A seen notification is still
 * unread and still on screen.
 */
export interface NotificationSeenMark {
  /**
   * When the panel was last open.
   *
   * ⚠ **Changed by every repeated mark**, the opposite of a dismissal's converging
   * `dismissedAt`. "I am looking now" is true of every call, and a watermark that froze
   * at the first open would never clear a badge again. It only ever moves forward — see
   * {@link import('./notification-seen-watermark.repository').NotificationSeenWatermarkRepository}.
   */
  readonly seenAt: Date;
}

import type { NotificationDismissal } from './notification-dismissal';

/** What dismissing is given. The recipient is the resolved actor, never request input. */
export interface DismissNotificationWrite {
  /** Who is dismissing. Taken from the `Actor`, so a caller cannot clear somebody else's panel. */
  readonly recipientId: string;
  readonly notificationId: string;
  readonly occurredAt: Date;
}

/**
 * The port onto `app.notification_dismissals`.
 *
 * **Two methods, one write and one read, and no `undismiss`.** Restoring a dismissed
 * notification is not a product affordance — the panel's `✕` is "this is dealt with",
 * and the comp's own model has no way back — so the port offers no way to write one. A
 * delete method existing "for symmetry" is a mutation somebody eventually exposes.
 *
 * ⚠ **Nothing here writes `app.outbox_events`**, and that is a decision rather than an
 * omission: the outbox exists so that a state change and the work that reacts to it
 * commit together (ADR-0006, addendum §10), and a dismissal has no reactor. Nothing
 * re-reads it, no push is sent, no other module's state depends on it, and an audit
 * entry would record a person tidying their own panel. `modules/moderation`'s repository
 * makes the same call for its own viewer-local hide state, for a privacy reason where
 * this one has an absence-of-consumer reason. If a second device ever needs to converge
 * on a dismissal, that is a sync-envelope mutation type, not an event.
 */
export interface NotificationDismissalRepository {
  /**
   * Record that this recipient has dismissed this notification, idempotently.
   *
   * @returns The dismissal as it now stands. A second call answers the **first**
   *   `dismissedAt`, unchanged.
   */
  dismiss(write: DismissNotificationWrite): Promise<NotificationDismissal>;

  /**
   * Which of this recipient's notifications they have dismissed.
   *
   * A membership set rather than rows, because the only question the read path asks is
   * "is this one unread" — the same shape
   * `modules/moderation`'s `findHiddenFor` answers the board with.
   *
   * @param recipientId - An `app.users.id`. From the resolved actor on the read path;
   *   this port takes a `string` the way every application-layer command does.
   */
  findDismissedFor(recipientId: string): Promise<ReadonlySet<string>>;
}

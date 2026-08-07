/**
 * One notification a recipient has dismissed.
 *
 * The whole of this module's per-viewer state: a dismissal exists or it does not, and
 * "unread" is its absence. There is deliberately no separate read flag — see
 * {@link import('./notification-dismissal.repository').NotificationDismissalRepository}.
 */
export interface NotificationDismissal {
  /**
   * The `notificationId` `notifications.list` served — the `app.outbox_events.event_id`
   * of the match that opened the grouping window.
   */
  readonly notificationId: string;
  /**
   * When it left the unread set.
   *
   * ⚠ **Unchanged by a repeated dismissal.** Idempotency means the second call returns
   * the state the first one established, not a fresh one that would make a replay look
   * like a new act — the same contract `modules/moderation`'s `hiddenAt` carries.
   */
  readonly dismissedAt: Date;
}

/** Which of a batch of dismissals the server took, and which it refused. */
export interface NotificationDismissalOutcome {
  readonly dismissed: readonly string[];
  readonly failed: readonly string[];
}

/**
 * Dismiss a set of notifications one at a time, tolerating a refusal on any of them.
 *
 * This is what "CLEAR ALL" is made of. There is deliberately no `dismissAll` procedure
 * — a server-side "all" would race whatever arrived between the reader's last refresh
 * and their tap, silently clearing notifications they never saw — so the client names
 * the notifications it is actually showing and dismisses those.
 *
 * ⚠ **A refusal must not abort the rest.** `notifications.dismiss` answers 404
 * `NOTIFICATION_UNAVAILABLE` for a notification that aged out of the retention window,
 * and one stale row near the top of the list is the common case, not the rare one.
 * Stopping there would leave a "CLEAR ALL" that clears nothing.
 *
 * Sequential rather than concurrent: this is a background tidy-up with no one waiting
 * on it, and a burst of parallel mutations from a phone on playa LTE is the shape that
 * produces timeouts.
 *
 * Never rejects — every failure is reported in {@link NotificationDismissalOutcome}, so
 * the caller can restore exactly the rows that are still unread.
 *
 * @param notificationIds - the notifications the panel is currently showing as unread.
 * @param dismiss - one call to `notifications.dismiss`.
 */
export async function dismissEachNotification(
  notificationIds: readonly string[],
  dismiss: (notificationId: string) => Promise<unknown>,
): Promise<NotificationDismissalOutcome> {
  const dismissed: string[] = [];
  const failed: string[] = [];

  for (const notificationId of notificationIds) {
    try {
      await dismiss(notificationId);
      dismissed.push(notificationId);
    } catch {
      failed.push(notificationId);
    }
  }

  return { dismissed, failed };
}

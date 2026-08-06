/**
 * One notification as a viewer reads it — the panel-side counterpart of the push the
 * flush already sent.
 *
 * **Identifiers and a timestamp, and nothing else.** M2-AC5 forbids an author name,
 * handle or avatar "in notifications" and M2-AC10 forbids any response containing a
 * hidden person's identifier "across bulletin read, notifications, and A's own bulletin
 * list". Satisfying both by *carrying no such field* is stronger than satisfying them by
 * redacting one: there is nothing here for a future edit to forget to redact, and the
 * client's follow-up read through `bulletins.*` is where §6a author projection already
 * happens.
 */
export interface GroupedNotification {
  /**
   * Stable key for this group — the `event_id` of the match that opened its window.
   *
   * An opaque identifier a client can key a list by. It is not a row in a notifications
   * table, because there is none: ADR-0006 makes the outbox row plus its consumer receipt
   * the record that a notification happened, and M5 ("delivery records subsystem") is
   * where a durable notification row would be introduced if one is ever needed.
   */
  readonly notificationId: string;
  /**
   * When the window opened — the `occurred_at` of the bulletin that started it.
   *
   * Not when the flush ran: a person reads "what happened", and two windows flushed by
   * the same scheduled run are two moments, not one.
   */
  readonly occurredAt: Date;
  /**
   * The bulletins in this group, de-duplicated, and only those the viewer may still see.
   *
   * Never empty — a group with nothing left to show is dropped rather than reported as
   * an empty notification.
   */
  readonly bulletinIds: readonly string[];
}

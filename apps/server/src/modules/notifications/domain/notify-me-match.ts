/**
 * One computed match, as it sits in the outbox waiting for its window to close.
 *
 * The stored form of {@link import('./notification.events').NotifyMeMatched}, plus the
 * `eventId` under which it was written — which is what the send handler writes its
 * `app.consumer_receipts` row against (ADR-0006).
 */
export interface NotifyMeMatch {
  /** `app.outbox_events.event_id` of the `NotifyMeMatched` row. */
  readonly eventId: string;
  readonly recipientId: string;
  readonly bulletinId: string;
  /** The bulletin's author, for the delivery-time re-check (ADR-0002:274-279). */
  readonly authorId: string;
  /** The triggering bulletin's `occurred_at` — what the window is measured over. */
  readonly occurredAt: Date;
}

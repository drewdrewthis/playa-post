/** What recording one connection request's delivery is given. */
export interface RecordConnectionRequestNotificationCommand {
  /** The triggering `ConnectionRequested` event, whose receipt this write claims. */
  readonly eventId: string;
  readonly processedAt: Date;
}

/**
 * The write port behind
 * {@link import('./deliver-connection-requested.handler').DeliverConnectionRequestedHandler}.
 *
 * The exact shape of
 * {@link import('./note-notification.repository').NoteNotificationRepository}, for the
 * same reasons: separate from the client-facing read port so read-only stays a
 * property, and the only write is a receipt because ADR-0006 makes the outbox row plus
 * its consumer receipt the record that a notification happened — there is no
 * notifications table, and this port must never grow one.
 */
export interface ConnectionRequestNotificationRepository {
  /**
   * Record that this `ConnectionRequested` event has become a notification.
   *
   * **The receipt is the whole effect, so one statement is the whole transaction.**
   * Idempotent: a redelivered event conflicts on the receipt's primary key and writes
   * nothing a second time (M2-AC8).
   */
  recordConnectionRequestNotification(
    command: RecordConnectionRequestNotificationCommand,
  ): Promise<void>;
}

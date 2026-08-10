/** What recording one pinned note's delivery is given. */
export interface RecordNoteNotificationCommand {
  /** The triggering `NotePinned` event, whose receipt this write claims. */
  readonly eventId: string;
  readonly processedAt: Date;
}

/**
 * The write port behind
 * {@link import('./deliver-note-pinned.handler').DeliverNotePinnedHandler}.
 *
 * **Separate from {@link import('./delivered-notification.repository').DeliveredNotificationRepository}
 * on purpose.** That port is the read side a client faces, and its docstring turns
 * "read-only" into a property rather than a habit; a write method on it would be one
 * convenience away from a read procedure that also delivers something.
 *
 * ⚠ **There is no `notifications` table, and this port must never grow one.** ADR-0006
 * makes the outbox row plus its consumer receipt the record that a notification
 * happened, which is why the only write here is a receipt — a durable notification row
 * belongs to M5's delivery-records subsystem.
 */
export interface NoteNotificationRepository {
  /**
   * Record that this `NotePinned` event has become a notification.
   *
   * **The receipt is the whole effect, so one statement is the whole transaction.**
   * Every other consumer in this module writes a receipt *and* something else and needs
   * a transaction to bind the two; here the receipt's presence is what
   * `findDeliveredNoteNotifications` reads, so the row's own atomicity is the guarantee
   * ADR-0006 asks for.
   *
   * Idempotent. A redelivered event conflicts on the receipt's primary key and writes
   * nothing a second time (M2-AC8) — obtained from the key rather than from bespoke
   * dedup logic.
   */
  recordNoteNotification(command: RecordNoteNotificationCommand): Promise<void>;
}

import type { DatabaseConnection } from '@playa-post/database';

import { DELIVER_NOTE_PINNED_CONSUMER } from '../application/deliver-note-pinned.handler';
import type {
  NoteNotificationRepository,
  RecordNoteNotificationCommand,
} from '../application/note-notification.repository';

/** Everything the repository needs, injected (addendum §12). */
export interface PostgresNoteNotificationRepositoryDependencies {
  /** Connected as `app_rw` and nothing else (ADR-0002 §2). */
  readonly database: DatabaseConnection;
}

/**
 * The write side of a note notification, behind {@link NoteNotificationRepository} — one
 * `app.consumer_receipts` row and nothing else.
 *
 * ⚠ **It touches neither `app.notes` nor `app.visible_notes`.** Delivery records that an
 * event arrived; it never reads the note, so no note text can reach a receipt, a log
 * line or a retry record through this path (ADR-0006, M2-AC16). The read side asks
 * `app.visible_notes` at disclosure time, which is also the only place authorization is
 * decided.
 *
 * Every statement is schema-qualified per ADR-0002's pooler-safety rules.
 */
export function createPostgresNoteNotificationRepository(
  dependencies: PostgresNoteNotificationRepositoryDependencies,
): NoteNotificationRepository {
  const { database } = dependencies;

  return {
    async recordNoteNotification(command: RecordNoteNotificationCommand): Promise<void> {
      // `do nothing` rather than a caught unique-violation: a redelivered `NotePinned`
      // must produce no second notification (M2-AC8, ADR-0006), and because the receipt
      // is this consumer's entire effect there is nothing conditional on whether this
      // call was the one that claimed it — which is what lets a single statement stand
      // in for the transaction every other consumer here needs.
      await database
        .insertInto('app.consumer_receipts')
        .values({
          consumer_name: DELIVER_NOTE_PINNED_CONSUMER,
          event_id: command.eventId,
          processed_at: command.processedAt,
        })
        .onConflict((conflict) => conflict.doNothing())
        .execute();
    },
  };
}

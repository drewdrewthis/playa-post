import type { DatabaseConnection } from '@playa-post/database';

import type {
  ConnectionRequestNotificationRepository,
  RecordConnectionRequestNotificationCommand,
} from '../application/connection-request-notification.repository';
import { DELIVER_CONNECTION_REQUESTED_CONSUMER } from '../application/deliver-connection-requested.handler';

/** Everything the repository needs, injected (addendum §12). */
export interface PostgresConnectionRequestNotificationRepositoryDependencies {
  /** Connected as `app_rw` and nothing else (ADR-0002 §2). */
  readonly database: DatabaseConnection;
}

/**
 * The write side of a connection-request notification, behind
 * {@link ConnectionRequestNotificationRepository} — one `app.consumer_receipts` row and
 * nothing else, the exact shape of `postgres-note-notification.repository.ts`.
 *
 * ⚠ **It touches `app.connection_requests` not at all.** Delivery records that an event
 * arrived; whether the request is still live in the owner's inbox is the read side's
 * question, asked at disclosure time.
 *
 * Every statement is schema-qualified per ADR-0002's pooler-safety rules.
 */
export function createPostgresConnectionRequestNotificationRepository(
  dependencies: PostgresConnectionRequestNotificationRepositoryDependencies,
): ConnectionRequestNotificationRepository {
  const { database } = dependencies;

  return {
    async recordConnectionRequestNotification(
      command: RecordConnectionRequestNotificationCommand,
    ): Promise<void> {
      // `do nothing` rather than a caught unique-violation: a redelivered
      // `ConnectionRequested` must produce no second notification (M2-AC8, ADR-0006).
      await database
        .insertInto('app.consumer_receipts')
        .values({
          consumer_name: DELIVER_CONNECTION_REQUESTED_CONSUMER,
          event_id: command.eventId,
          processed_at: command.processedAt,
        })
        .onConflict((conflict) => conflict.doNothing())
        .execute();
    },
  };
}

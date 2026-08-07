import type { DatabaseConnection } from '@playa-post/database';

import type { NotificationDismissal } from '../domain/notification-dismissal';
import type {
  DismissNotificationWrite,
  NotificationDismissalRepository,
} from '../domain/notification-dismissal.repository';

/** Everything the repository needs, injected (addendum §12). */
export interface PostgresNotificationDismissalRepositoryDependencies {
  /** Connected as `app_rw` and nothing else (ADR-0002 §2). */
  readonly database: DatabaseConnection;
}

/**
 * `app.notification_dismissals`, behind {@link NotificationDismissalRepository}.
 *
 * Every statement is schema-qualified per ADR-0002's pooler-safety rules: with
 * `search_path` outside this file's control, an unqualified name is a silent
 * cross-schema read waiting for a `public.notification_dismissals` to exist.
 *
 * ⚠ **Nothing here writes `app.outbox_events`**, matching
 * `modules/moderation`'s repository. A dismissal has no consumer — see
 * {@link NotificationDismissalRepository} for the full argument — and an event added
 * here would put a per-person UI act into a delivery ledger that the audit consumer then
 * durably records.
 *
 * ⚠ **No statement here reads `app.outbox_events` or `app.consumer_receipts`.** Whether
 * the acting recipient may dismiss the named notification is decided *before* this
 * layer, through
 * {@link import('../application/delivered-notification.repository').DeliveredNotificationRepository.hasDeliveredMatch}.
 * A join to either table here would be a second answer to "is this notification yours",
 * reachable only through the write path.
 */
export function createPostgresNotificationDismissalRepository(
  dependencies: PostgresNotificationDismissalRepositoryDependencies,
): NotificationDismissalRepository {
  const { database } = dependencies;

  return {
    async dismiss(write: DismissNotificationWrite): Promise<NotificationDismissal> {
      // `on conflict do nothing` rather than a read-then-write, the shape
      // `modules/moderation` established: expressing convergence as the primary key's
      // own behaviour means two concurrent dismissals cannot both decide there is no
      // row yet.
      const inserted = await database
        .insertInto('app.notification_dismissals')
        .values({
          recipient_id: write.recipientId,
          notification_id: write.notificationId,
          dismissed_at: write.occurredAt,
        })
        .onConflict((onConflict) =>
          onConflict.columns(['recipient_id', 'notification_id']).doNothing(),
        )
        .returning('dismissed_at')
        .executeTakeFirst();

      if (inserted !== undefined) {
        return { notificationId: write.notificationId, dismissedAt: inserted.dismissed_at };
      }

      // Conflicted, so this pair is already recorded. Answer with the *original*
      // timestamp: idempotency means the second call returns the state the first one
      // established, not a fresh one that would make a replay look like a new act.
      const existing = await database
        .selectFrom('app.notification_dismissals')
        .select('dismissed_at')
        .where('recipient_id', '=', write.recipientId)
        .where('notification_id', '=', write.notificationId)
        .executeTakeFirstOrThrow();

      return { notificationId: write.notificationId, dismissedAt: existing.dismissed_at };
    },

    async findDismissedFor(recipientId: string): Promise<ReadonlySet<string>> {
      const rows = await database
        .selectFrom('app.notification_dismissals')
        .select('notification_id')
        .where('recipient_id', '=', recipientId)
        .execute();

      return new Set(rows.map((row) => row.notification_id));
    },
  };
}

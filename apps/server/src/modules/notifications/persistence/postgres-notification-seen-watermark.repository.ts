import type { DatabaseConnection } from '@playa-post/database';

import type { NotificationSeenMark } from '../domain/notification-seen-mark';
import type {
  MarkNotificationsSeenWrite,
  NotificationSeenWatermarkRepository,
} from '../domain/notification-seen-watermark.repository';

/** Everything the repository needs, injected (addendum §12). */
export interface PostgresNotificationSeenWatermarkRepositoryDependencies {
  /** Connected as `app_rw` and nothing else (ADR-0002 §2). */
  readonly database: DatabaseConnection;
}

/**
 * `app.notification_seen_watermarks`, behind {@link NotificationSeenWatermarkRepository}.
 *
 * Every statement is schema-qualified per ADR-0002's pooler-safety rules: with
 * `search_path` outside this file's control, an unqualified name is a silent cross-schema
 * read waiting for a `public.notification_seen_watermarks` to exist.
 *
 * ⚠ **Nothing here writes `app.outbox_events`**, matching this module's dismissal
 * repository. Opening a panel has no consumer — see
 * {@link NotificationSeenWatermarkRepository} for the full argument — and an event added
 * here would put "this person glanced at their bell" into a delivery ledger the audit
 * consumer then durably records.
 *
 * ⚠ **No statement here reads a notification.** Which notifications the watermark covers
 * is decided on the read path, by comparing it to each notification's `occurred_at`
 * (`application/list-notifications.query.ts`). A join here would be a second definition of
 * "seen" living in the layer least able to state it.
 */
export function createPostgresNotificationSeenWatermarkRepository(
  dependencies: PostgresNotificationSeenWatermarkRepositoryDependencies,
): NotificationSeenWatermarkRepository {
  const { database } = dependencies;

  return {
    async markSeen(write: MarkNotificationsSeenWrite): Promise<NotificationSeenMark> {
      // `on conflict … do update … where` rather than a read-then-write, the shape
      // `modules/moderation` established and this module's dismissal repository follows:
      // expressing the rule as the primary key's own behaviour means two concurrent opens
      // cannot both decide there is no row yet.
      //
      // ⚠ The `where` is what makes the watermark **monotonic**. Without it, a retry that
      // arrives late — or a second device whose clock runs slow — would move the watermark
      // backwards and un-see notifications the person has already been shown. With it, the
      // update simply does not fire, and the read below answers the moment that stands.
      const upserted = await database
        .insertInto('app.notification_seen_watermarks')
        .values({
          recipient_id: write.recipientId,
          last_seen_at: write.occurredAt,
        })
        .onConflict((onConflict) =>
          onConflict
            .column('recipient_id')
            .doUpdateSet({ last_seen_at: write.occurredAt })
            .where('app.notification_seen_watermarks.last_seen_at', '<', write.occurredAt),
        )
        .returning('last_seen_at')
        .executeTakeFirst();

      if (upserted !== undefined) {
        return { seenAt: upserted.last_seen_at };
      }

      // The `where` suppressed the update, so a *later* moment is already recorded.
      // Answering with it rather than with the moment this call asked for keeps the
      // return value a description of the row: a caller must never be told the watermark
      // moved somewhere it did not.
      const existing = await database
        .selectFrom('app.notification_seen_watermarks')
        .select('last_seen_at')
        .where('recipient_id', '=', write.recipientId)
        .executeTakeFirstOrThrow();

      return { seenAt: existing.last_seen_at };
    },

    async findSeenWatermarkFor(recipientId: string): Promise<Date | null> {
      const row = await database
        .selectFrom('app.notification_seen_watermarks')
        .select('last_seen_at')
        .where('recipient_id', '=', recipientId)
        .executeTakeFirst();

      return row?.last_seen_at ?? null;
    },
  };
}

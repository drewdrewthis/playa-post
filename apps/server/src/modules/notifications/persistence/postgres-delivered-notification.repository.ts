import { sql, type DatabaseConnection } from '@playa-post/database';

import type { ViewerId } from '../../../shared/auth/viewer-id';
import type {
  DeliveredNotificationMatch,
  DeliveredNotificationRepository,
} from '../application/delivered-notification.repository';
import { SEND_GROUPED_PUSH_CONSUMER } from '../application/send-grouped-push.handler';
import { NOTIFY_ME_MATCHED } from '../domain/notification.events';

/** Everything the repository needs, injected (addendum §12). */
export interface PostgresDeliveredNotificationRepositoryDependencies {
  /** Connected as `app_rw` and nothing else (ADR-0002 §2). */
  readonly database: DatabaseConnection;
}

/** One flushed `NotifyMeMatched` row, as the database returns it. */
interface DeliveredMatchRow {
  readonly event_id: string;
  readonly occurred_at: Date;
  readonly aggregate_id: string;
}

/** One surviving bulletin identifier from `app.visible_bulletins`. */
interface VisibleBulletinIdRow {
  readonly bulletin_id: string;
}

/** Existence probe for one recipient's flushed match. */
interface DeliveredMatchExistsRow {
  readonly exists: boolean;
}

/**
 * The read side of this module's outbox rows, behind
 * {@link DeliveredNotificationRepository}.
 *
 * **Two statements, and they are separate on purpose.** The first reports what the flush
 * produced; the second asks `app.visible_bulletins` what the viewer may still see. Fusing
 * them into one join would filter *before* grouping — see
 * {@link import('../application/list-notifications.query').createListNotificationsQuery},
 * whose step 3 explains why that silently re-shapes a window the flush already committed
 * to. Keeping them apart is what lets the application layer choose the order.
 *
 * `recipientId` lives in the `jsonb` payload rather than in a column, because
 * `app.outbox_events` is L2's shared envelope and this module does not migrate columns
 * onto a table it does not own. `aggregate_id` carries the bulletin and the viewer is a
 * bound parameter, so the only field read out of `jsonb` is the one being *filtered on*
 * — never one whose absence would have to be guessed at.
 *
 * Every statement is schema-qualified per ADR-0002's pooler-safety rules.
 */
export function createPostgresDeliveredNotificationRepository(
  dependencies: PostgresDeliveredNotificationRepositoryDependencies,
): DeliveredNotificationRepository {
  const { database } = dependencies;

  return {
    async findDeliveredMatches(
      viewerId: ViewerId,
    ): Promise<readonly DeliveredNotificationMatch[]> {
      // The receipt join is the "already flushed" test, and an inner join is the whole
      // of it: a `NotifyMeMatched` row with no `SendGroupedPushHandler` receipt is a
      // match whose window has not closed (ADR-0006 — the receipt is the record that a
      // consumer processed an event).
      //
      // `viewerId` travels as a bound parameter, which is what ADR-0002 §5 means by
      // "every viewer-scoped read passes viewer_id explicitly": no session GUC, no
      // ambient state a transaction-mode pooler could hand to the wrong session.
      const { rows } = await sql<DeliveredMatchRow>`
        select matched.event_id, matched.occurred_at, matched.aggregate_id
          from app.outbox_events as matched
          join app.consumer_receipts as receipt
            on receipt.event_id = matched.event_id
           and receipt.consumer_name = ${SEND_GROUPED_PUSH_CONSUMER}
         where matched.event_type = ${NOTIFY_ME_MATCHED}
           and matched.payload ->> 'recipientId' = ${viewerId}::text
         order by matched.occurred_at asc, matched.event_id asc
      `.execute(database);

      return rows.map((row) => ({
        eventId: row.event_id,
        // Not read back out of the payload: it is the value this statement filtered on,
        // so re-parsing it from `jsonb` could only ever produce a different answer by
        // being wrong.
        recipientId: viewerId,
        bulletinId: row.aggregate_id,
        occurredAt: row.occurred_at,
      }));
    },

    async findVisibleBulletinIds(
      viewerId: ViewerId,
      bulletinIds: readonly string[],
    ): Promise<readonly string[]> {
      if (bulletinIds.length === 0) {
        return [];
      }

      const candidates = [...bulletinIds];

      // `app.visible_bulletins` and nothing else. A `join app.bulletins` here — even to
      // check `archived_at`, even conveniently — would be the second definition of "what
      // may this viewer see" that ADR-0002 §6 forbids, in the one place where nobody but
      // the recipient would ever notice it was wrong.
      const { rows } = await sql<VisibleBulletinIdRow>`
        select bulletin_id
          from app.visible_bulletins(${viewerId})
         where bulletin_id = any(${candidates}::uuid[])
      `.execute(database);

      return rows.map((row) => row.bulletin_id);
    },

    async hasDeliveredMatch(recipientId: string, notificationId: string): Promise<boolean> {
      // The same three predicates `findDeliveredMatches` uses — the event type, the
      // recipient in the payload, and the flush receipt — narrowed to one identifier.
      // Written as `exists` rather than as a `findDeliveredMatches(…).some(…)` in the
      // service, so a caller cannot accidentally pay for the whole history to answer a
      // yes/no, and so the two spellings of "is this a delivered match" stay one
      // statement's worth of SQL apart rather than one layer's.
      const { rows } = await sql<DeliveredMatchExistsRow>`
        select exists (
          select 1
            from app.outbox_events as matched
            join app.consumer_receipts as receipt
              on receipt.event_id = matched.event_id
             and receipt.consumer_name = ${SEND_GROUPED_PUSH_CONSUMER}
           where matched.event_id = ${notificationId}
             and matched.event_type = ${NOTIFY_ME_MATCHED}
             and matched.payload ->> 'recipientId' = ${recipientId}
        ) as exists
      `.execute(database);

      return rows[0]?.exists ?? false;
    },
  };
}

import { sql, type DatabaseConnection } from '@playa-post/database';

import type { ViewerId } from '../../../shared/auth/viewer-id';
import { DELIVER_CONNECTION_REQUESTED_CONSUMER } from '../application/deliver-connection-requested.handler';
import { DELIVER_NOTE_PINNED_CONSUMER } from '../application/deliver-note-pinned.handler';
import type {
  DeliveredConnectionRequestNotification,
  DeliveredNoteNotification,
  DeliveredNotificationMatch,
  DeliveredNotificationRepository,
} from '../application/delivered-notification.repository';
import { SEND_GROUPED_PUSH_CONSUMER } from '../application/send-grouped-push.handler';
import { CONNECTION_REQUESTED, NOTE_PINNED, NOTIFY_ME_MATCHED } from '../domain/notification.events';

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

/** One delivered `NotePinned` row, as the database returns it. */
interface DeliveredNoteRow {
  readonly event_id: string;
  readonly occurred_at: Date;
  readonly aggregate_id: string;
}

/** One surviving bulletin identifier from `app.visible_bulletins`. */
interface VisibleBulletinIdRow {
  readonly bulletin_id: string;
}

/** One surviving note identifier from `app.visible_notes`. */
interface VisibleNoteIdRow {
  readonly note_id: string;
}

/** Existence probe for one recipient's flushed match. */
interface DeliveredMatchExistsRow {
  readonly exists: boolean;
}

/**
 * The read side of this module's outbox rows, behind
 * {@link DeliveredNotificationRepository}.
 *
 * **What was delivered and what may still be seen are separate statements, on purpose.**
 * One pair reports what the flush produced and what `app.visible_bulletins` still allows;
 * the other pair does the same for pinned notes through `app.visible_notes`. Fusing a
 * pair into one join would filter *before* grouping — see
 * {@link import('../application/list-notifications.query').createListNotificationsQuery},
 * whose step 3 explains why that silently re-shapes a window the flush already committed
 * to. Keeping them apart is what lets the application layer choose the order.
 *
 * **The two kinds are two statements rather than one union**, for the same reason: a
 * union would have to carry a discriminator, and every caller downstream would then be
 * separating them again — including the grouper, which must see bulletin matches only.
 *
 * `recipientId` lives in the `jsonb` payload rather than in a column, because
 * `app.outbox_events` is L2's shared envelope and this module does not migrate columns
 * onto a table it does not own. `aggregate_id` carries the bulletin or the note and the
 * viewer is a bound parameter, so the only field read out of `jsonb` is the one being
 * *filtered on* — never one whose absence would have to be guessed at.
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

    async findDeliveredNoteNotifications(
      viewerId: ViewerId,
    ): Promise<readonly DeliveredNoteNotification[]> {
      // The same shape as `findDeliveredMatches`, against the other event type and the
      // other consumer's receipt: the join is the "already delivered" test, and a
      // `NotePinned` row the drainer has not reached yet has no receipt and is therefore
      // not yet a notification.
      //
      // ⚠ `app.notes` is not named here and must not be. Whether the viewer may still
      // read the note is `findVisibleNoteIds`' question, asked through
      // `app.visible_notes`; joining the table would be the second definition of that
      // ADR-0002 §6 forbids, in the one place only the recipient would ever notice.
      const { rows } = await sql<DeliveredNoteRow>`
        select pinned.event_id, pinned.occurred_at, pinned.aggregate_id
          from app.outbox_events as pinned
          join app.consumer_receipts as receipt
            on receipt.event_id = pinned.event_id
           and receipt.consumer_name = ${DELIVER_NOTE_PINNED_CONSUMER}
         where pinned.event_type = ${NOTE_PINNED}
           and pinned.payload ->> 'recipientId' = ${viewerId}::text
         order by pinned.occurred_at asc, pinned.event_id asc
      `.execute(database);

      return rows.map((row) => ({
        eventId: row.event_id,
        noteId: row.aggregate_id,
        occurredAt: row.occurred_at,
      }));
    },

    async findVisibleNoteIds(
      viewerId: ViewerId,
      noteIds: readonly string[],
    ): Promise<readonly string[]> {
      if (noteIds.length === 0) {
        return [];
      }

      const candidates = [...noteIds];

      // ⚠ `note_id` and nothing else. `app.visible_notes` also returns `body` and an
      // author card; selecting either would put a note's text — the most private thing
      // this product stores — into the notifications path, where the whole design is
      // that it never arrives.
      const { rows } = await sql<VisibleNoteIdRow>`
        select note_id
          from app.visible_notes(${viewerId})
         where note_id = any(${candidates}::uuid[])
      `.execute(database);

      return rows.map((row) => row.note_id);
    },

    async findDeliveredConnectionRequestNotifications(
      viewerId: ViewerId,
    ): Promise<readonly DeliveredConnectionRequestNotification[]> {
      // The same shape as its two siblings, against the third event type and its
      // consumer's receipt. ⚠ The recipient key in a `ConnectionRequested` payload is
      // `ownerId` — the request inbox's owner, matching the request row's own column —
      // not `recipientId`; filtering on the wrong key here would silently serve nobody.
      //
      // ⚠ `app.connection_requests` is not named here and must not be. Whether the
      // request is still live in the owner's inbox is `modules/connections`' question,
      // asked through its exported directory at the application layer.
      const { rows } = await sql<DeliveredNoteRow>`
        select requested.event_id, requested.occurred_at, requested.aggregate_id
          from app.outbox_events as requested
          join app.consumer_receipts as receipt
            on receipt.event_id = requested.event_id
           and receipt.consumer_name = ${DELIVER_CONNECTION_REQUESTED_CONSUMER}
         where requested.event_type = ${CONNECTION_REQUESTED}
           and requested.payload ->> 'ownerId' = ${viewerId}::text
         order by requested.occurred_at asc, requested.event_id asc
      `.execute(database);

      return rows.map((row) => ({
        eventId: row.event_id,
        connectionRequestId: row.aggregate_id,
        occurredAt: row.occurred_at,
      }));
    },

    async hasDeliveredMatch(recipientId: string, notificationId: string): Promise<boolean> {
      // The same predicates the two read statements use — the event type, the recipient
      // in the payload, and *that kind's* receipt — narrowed to one identifier. Written
      // as `exists` rather than as a `findDeliveredMatches(…).some(…)` in the service, so
      // a caller cannot accidentally pay for the whole history to answer a yes/no, and so
      // the two spellings of "is this a delivered notification" stay one statement's
      // worth of SQL apart rather than one layer's.
      //
      // ⚠ **Each event type is paired with its own consumer inside the `or`**, never
      // reduced to "has some receipt". The receipt is what makes a notification exist, so
      // a `NotePinned` row carrying only an audit receipt is not one — and a check that
      // accepted any receipt would let a caller dismiss a delivery that had not happened.
      //
      // ⚠ **The recipient predicate lives inside each branch too**, because the kinds do
      // not agree on the payload key: a `ConnectionRequested` payload addresses its
      // recipient as `ownerId` (the request inbox's owner), the other two as
      // `recipientId`. One shared predicate on either key would silently orphan the
      // other kind's dismissals.
      const { rows } = await sql<DeliveredMatchExistsRow>`
        select exists (
          select 1
            from app.outbox_events as delivered
            join app.consumer_receipts as receipt
              on receipt.event_id = delivered.event_id
           where delivered.event_id = ${notificationId}
             and (
                   (delivered.event_type = ${NOTIFY_ME_MATCHED}
                    and receipt.consumer_name = ${SEND_GROUPED_PUSH_CONSUMER}
                    and delivered.payload ->> 'recipientId' = ${recipientId})
                or (delivered.event_type = ${NOTE_PINNED}
                    and receipt.consumer_name = ${DELIVER_NOTE_PINNED_CONSUMER}
                    and delivered.payload ->> 'recipientId' = ${recipientId})
                or (delivered.event_type = ${CONNECTION_REQUESTED}
                    and receipt.consumer_name = ${DELIVER_CONNECTION_REQUESTED_CONSUMER}
                    and delivered.payload ->> 'ownerId' = ${recipientId})
             )
        ) as exists
      `.execute(database);

      return rows[0]?.exists ?? false;
    },
  };
}

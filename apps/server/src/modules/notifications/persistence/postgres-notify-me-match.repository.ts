import { randomUUID } from 'node:crypto';

import { sql, type DatabaseConnection } from '@playa-post/database';

import { EVALUATE_NOTIFY_ME_CONSUMER } from '../application/evaluate-notify-me.handler';
import type {
  AuthorizedMatchQuery,
  CompleteWindowCommand,
  EligibleRecipientsQuery,
  NotifyMeMatchRepository,
  RecordMatchesCommand,
} from '../application/notify-me-match.repository';
import { SEND_GROUPED_PUSH_CONSUMER } from '../application/send-grouped-push.handler';
import { NOTIFY_ME_MATCHED } from '../domain/notification.events';
import type { NotifyMeMatch } from '../domain/notify-me-match';

/** Everything the repository needs, injected (addendum §12). */
export interface PostgresNotifyMeMatchRepositoryDependencies {
  /** Connected as `app_rw` and nothing else (ADR-0002 §2). */
  readonly database: DatabaseConnection;
}

/**
 * `app.outbox_events.status`, ADR-0006's vocabulary: `pending | claimed | published |
 * dead`.
 *
 * ⚠ **The drainer is excluded from these rows, and this is the sweep that depends on
 * it** (M2.14). The grouping-window flush is one of ADR-0006's *scheduled* jobs rather
 * than a drainer consumer, so it reads and retires `NotifyMeMatched` rows itself —
 * which only works while the generic drainer never claims one, because a claimed row
 * reads `status='claimed'` and vanishes from the `OUTBOX_PENDING` sweep below. That
 * exclusion is declared by `domain/notification.events.ts`'s
 * `SELF_DRAINED_EVENT_TYPES` and passed to the drainer by the composition root.
 */
const OUTBOX_PENDING = 'pending';
const OUTBOX_PUBLISHED = 'published';

/**
 * The notification side of `app.outbox_events`, behind
 * {@link NotifyMeMatchRepository}.
 *
 * **Every read of a bulletin here goes through `app.visible_bulletins`** — the one
 * definition of what a viewer may see (ADR-0002 §6, ADR-0004:75-77), which itself
 * composes `app.visible_people`. This module never names `app.bulletins`, and never
 * re-derives reachability: a notification that decided
 * visibility for itself would be the second answer R2 is about, and the delivery path
 * is the worst place to have one because nobody sees the result but the recipient.
 *
 * Every statement is schema-qualified per ADR-0002's pooler-safety rules.
 *
 * ⚠ This file writes `app.outbox_events` **and** `app.consumer_receipts` in one
 * transaction, which is not a layering slip: ADR-0006 requires a consumer's receipt and
 * its effect to be one transactional fact, and a port per table would make the
 * atomicity a convention rather than a guarantee.
 */
export function createPostgresNotifyMeMatchRepository(
  dependencies: PostgresNotifyMeMatchRepositoryDependencies,
): NotifyMeMatchRepository {
  const { database } = dependencies;

  return {
    async findEligibleRecipients(query: EligibleRecipientsQuery): Promise<readonly string[]> {
      // ADR-0020 D1's candidate set, as one statement. ⚠ This is the module's one read
      // of `app.users`, and it reads **ids only** — the disclosure rule this file's
      // docblock defends guards names and contact fields, not the existence of an id
      // the outbox already carries. Visibility is still `app.visible_bulletins`'s
      // answer, asked per candidate; the opt-out is ADR-0020 D3's absence-means-on.
      const { rows } = await sql<{ id: string }>`
        select u.id
          from app.users u
         where u.id <> ${query.authorId}
           and not exists (select 1
                             from app.notification_optouts o
                            where o.owner_id = u.id and o.kind = 'bulletins')
           and exists (select 1
                         from app.visible_bulletins(u.id) vb
                        where vb.bulletin_id = ${query.bulletinId})
         order by u.id
      `.execute(database);

      return rows.map((row) => row.id);
    },

    async isAuthorizedMatch(command: AuthorizedMatchQuery): Promise<boolean> {
      // ADR-0007's grammar, evaluated as **one static statement with bound
      // parameters** rather than as a second compiled filter. The board's compiler
      // (`modules/bulletins/persistence/board-filter.ts`) belongs to the module that
      // owns the authorized set and cannot be imported across that boundary; a
      // hand-rolled copy of it here would be the "three ad-hoc filters" ADR-0007's
      // Reuse section exists to prevent. Two parameters over a fixed predicate is not
      // a compiler — the SQL is identical for every caller, so the only thing a saved
      // query can change is what a fixed comparison is compared against.
      const types = [...command.query.types];
      // `plainto_tsquery` ANDs the words of one string, which is the same conjunction
      // the board builds by ANDing one call per term (ADR-0007:35, "implicit AND").
      // Joining first keeps this to one parameter and one static predicate.
      const textQuery = command.query.text.join(' ');

      // `recipientId` travels as a bound parameter, which is what ADR-0002 §5 means by
      // "every viewer-scoped read passes viewer_id explicitly": no session GUC, no
      // ambient state a transaction-mode pooler could hand to the wrong session.
      const { rows } = await sql<{ matched: number }>`
        select 1 as matched
          from app.visible_bulletins(${command.recipientId})
         where bulletin_id = ${command.bulletinId}
           and (pg_catalog.cardinality(${types}::text[]) = 0 or type = any(${types}::text[]))
           and (${textQuery}::text = ''
                or search_document @@ pg_catalog.plainto_tsquery('simple', ${textQuery}))
         limit 1
      `.execute(database);

      return rows.length > 0;
    },

    async recordMatches(command: RecordMatchesCommand): Promise<void> {
      await database.transaction().execute(async (transaction) => {
        // The receipt goes first, and its absence is the answer. `do nothing` returning
        // no row means another delivery of this event already ran — so this one writes
        // nothing and the redelivery produces no second match (M2-AC8, ADR-0006).
        const claimed = await transaction
          .insertInto('app.consumer_receipts')
          .values({
            consumer_name: EVALUATE_NOTIFY_ME_CONSUMER,
            event_id: command.eventId,
            processed_at: command.processedAt,
          })
          .onConflict((conflict) => conflict.doNothing())
          .returning('event_id')
          .executeTakeFirst();

        if (claimed === undefined || command.matches.length === 0) {
          return;
        }

        await transaction
          .insertInto('app.outbox_events')
          .values(
            command.matches.map((match) => ({
              // ADR-0006 names UUID v7; PostgreSQL 17 has no `uuidv7()` and M2 adds no
              // dependency for one. v4 is a correct key — the ADR guarantees no
              // ordering and consumers must not assume any.
              event_id: randomUUID(),
              event_type: match.type,
              occurred_at: match.occurredAt,
              actor_id: match.authorId,
              aggregate_id: match.bulletinId,
              // Identifiers only. No title, no body, no author name: the flush re-reads
              // authorization before it sends, and the push itself carries less than
              // this row does (ADR-0006, M2-AC16, M2-AC21).
              payload: {
                recipientId: match.recipientId,
                bulletinId: match.bulletinId,
                authorId: match.authorId,
              },
            })),
          )
          .execute();
      });
    },

    async findPendingMatches(): Promise<readonly NotifyMeMatch[]> {
      const rows = await database
        .selectFrom('app.outbox_events')
        .select(['event_id', 'occurred_at', 'aggregate_id', 'payload'])
        .where('event_type', '=', NOTIFY_ME_MATCHED)
        .where('status', '=', OUTBOX_PENDING)
        // Ascending, because the grouping window is anchored to the *oldest* match and
        // the grouper needs to see it first to be reading a window rather than a batch.
        .orderBy('occurred_at', 'asc')
        .orderBy('event_id', 'asc')
        .execute();

      return rows.flatMap((row) => {
        const payload = asRecord(row.payload);
        const recipientId = payload['recipientId'];
        const authorId = payload['authorId'];

        // A row whose payload lost its identifiers cannot be authorized against
        // anybody, so it is skipped rather than delivered on a guess. It stays
        // `pending` and therefore visible to an operator, which is the point.
        return typeof recipientId === 'string' && typeof authorId === 'string'
          ? [
              {
                eventId: row.event_id,
                recipientId,
                bulletinId: row.aggregate_id,
                authorId,
                occurredAt: row.occurred_at,
              },
            ]
          : [];
      });
    },

    async completeWindow(command: CompleteWindowCommand): Promise<void> {
      await database.transaction().execute(async (transaction) => {
        const claimed = await transaction
          .insertInto('app.consumer_receipts')
          .values(
            command.matches.map((match) => ({
              consumer_name: SEND_GROUPED_PUSH_CONSUMER,
              event_id: match.eventId,
              processed_at: command.processedAt,
            })),
          )
          .onConflict((conflict) => conflict.doNothing())
          .returning('event_id')
          .execute();

        if (claimed.length === 0) {
          // Another flush already delivered this window. Nothing to send, and nothing
          // to retire — whoever claimed it did both.
          return;
        }

        const claimedIds = claimed.map((row) => row.event_id);
        const claimedSet = new Set(claimedIds);

        await transaction
          .updateTable('app.outbox_events')
          .set({ status: OUTBOX_PUBLISHED })
          .where('event_id', 'in', claimedIds)
          .execute();

        // ⚠ Inside the transaction, after the receipt, before the commit — ADR-0002
        // §11's ordering exactly. The re-check and the dispatch it guards are one
        // atomic decision, and a transport failure rolls the receipt back so the window
        // is retried rather than silently lost (at-least-once, ADR-0006).
        await command.dispatch(command.matches.filter((match) => claimedSet.has(match.eventId)));
      });
    },
  };
}

/** A `jsonb` payload as a readable record. Anything else reads as empty, not as a throw. */
function asRecord(payload: unknown): Record<string, unknown> {
  return typeof payload === 'object' && payload !== null && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

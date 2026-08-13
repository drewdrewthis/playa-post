import { randomUUID } from 'node:crypto';

import { sql, type DatabaseConnection } from '@playa-post/database';

import type {
  NotifyMeQueryDirectory,
  SavedNotifyMeQuery,
} from '../application/notify-me-query.directory';
import { BOARD_QUERY_AST_VERSION } from '../domain/board-query-grammar';
import type { NotifyMeQuery } from '../domain/notify-me-query';
import { NotifyMeQueryConflictError } from '../domain/notify-me-query.errors';
import { notifyMeQueryChanged, type NotifyMeQueryChanged } from '../domain/notify-me-query.events';
import type {
  NotifyMeQueryRepository,
  SaveNotifyMeQuery,
} from '../domain/notify-me-query.repository';

import { toBoardQuery, toNotifyMeQuery, type NotifyMeQueryRow } from './notify-me-query.mapper';

/** Everything the repository needs, injected (addendum §12). */
export interface PostgresNotifyMeQueryRepositoryDependencies {
  /** Connected as `app_rw` and nothing else (ADR-0002 §2). */
  readonly database: DatabaseConnection;
}

/**
 * `app.notify_me_queries`, behind both of this module's ports.
 *
 * One object implementing two interfaces, because they describe two *questions* over
 * one table: {@link NotifyMeQueryRepository} is the owner writing their own query,
 * and {@link NotifyMeQueryDirectory} is the evaluation path reading everybody's projected
 * filter. Consumers declare whichever they need, so the notification evaluator cannot
 * reach a write and the update service cannot enumerate other people's queries.
 *
 * **This is the only file in the system allowed to name `app.notify_me_queries`**
 * (addendum §19: cross-module reads go through the application interface above, never
 * a second module's `SELECT`). `no-sql-outside-persistence` catches a `sql` tag placed
 * anywhere else in this module; nothing but review catches another module quietly
 * selecting from this table, which is why the directory port exists at all.
 *
 * Every statement is schema-qualified (`app.notify_me_queries`, never
 * `notify_me_queries`) per ADR-0002's pooler-safety rules.
 *
 * ⚠ This file also writes `app.outbox_events`, which is not a layering slip: a state
 * change and its event are **one transactional fact** (addendum §10, ADR-0006), and a
 * port per table would make the atomicity a convention two services have to remember
 * rather than a guarantee the database enforces.
 */
export function createPostgresNotifyMeQueryRepository(
  dependencies: PostgresNotifyMeQueryRepositoryDependencies,
): NotifyMeQueryRepository & NotifyMeQueryDirectory {
  const { database } = dependencies;

  return {
    async save(write: SaveNotifyMeQuery): Promise<NotifyMeQuery> {
      return database.transaction().execute(async (transaction) => {
        // `types`/`text` are copied into mutable arrays because the generated `jsonb`
        // column type is kysely-codegen's `Json`, whose arrays are mutable. Nothing
        // about the value changes; this is a variance cast with a runtime copy.
        const ast = { types: [...write.query.types], text: [...write.query.text] };

        // Ownership is in the `WHERE`, not in a prior read. ADR-0005 precedence rule 1
        // wants actorship settled before version comparison; expressing it as a
        // predicate on the one statement means there is no ordering for a future edit
        // to get wrong, and no window a concurrent write could exploit. The owner is
        // the whole address: `unique (owner_id)` holds the table at one row per person.
        const row =
          write.expectedVersion === undefined
            ? await insertQuery(transaction, write, ast)
            : await transaction
                .updateTable('app.notify_me_queries')
                .set({
                  source_text: write.sourceText,
                  ast,
                  ast_version: write.astVersion,
                  version: sql<number>`version + 1`,
                  updated_at: write.updatedAt,
                })
                .where('owner_id', '=', write.ownerId)
                .where('version', '=', write.expectedVersion)
                .returningAll()
                .executeTakeFirst();

        if (row === undefined) {
          // Nothing was written, and this refusal is deliberately incurious about why.
          // Re-reading to tell "wrong version" from "no such row" would answer, for an
          // actor who has no query, whether *somebody else's* version is the one they
          // guessed — the leak channel ADR-0005 names and M2-AC19 asserts against.
          throw new NotifyMeQueryConflictError();
        }

        const saved = toNotifyMeQuery(row);
        await appendOutboxEvent(transaction, notifyMeQueryChanged(saved));

        return saved;
      });
    },

    async findAllCurrent(): Promise<readonly SavedNotifyMeQuery[]> {
      const rows = await database
        .selectFrom('app.notify_me_queries')
        // `source_text` is not selected. The evaluator has no use for it and the
        // narrower projection is what keeps somebody's typed words out of a code path
        // whose whole job is to fan out to other systems (ADR-0006, M2-AC16).
        .select(['owner_id', 'ast'])
        // Queries stored under another grammar are excluded rather than reinterpreted
        // (ADR-0007:70-72). Filtered in SQL so the exclusion cannot be forgotten by a
        // caller that maps rows itself.
        .where('ast_version', '=', BOARD_QUERY_AST_VERSION)
        .execute();

      return rows.map((row) => ({ ownerId: row.owner_id, query: toBoardQuery(row.ast) }));
    },
  };
}

/**
 * Insert the actor's query.
 *
 * No cap check: `unique (owner_id)` already caps the table at one row per person, so
 * there is nothing for a count to bound that the key does not.
 */
async function insertQuery(
  transaction: DatabaseConnection,
  write: SaveNotifyMeQuery,
  ast: { types: string[]; text: string[] },
): Promise<NotifyMeQueryRow | undefined> {
  return transaction
    .insertInto('app.notify_me_queries')
    .values({
      owner_id: write.ownerId,
      source_text: write.sourceText,
      ast,
      ast_version: write.astVersion,
      updated_at: write.updatedAt,
    })
    // A row already existing IS the version mismatch: the caller said "I have none".
    // `do nothing` rather than `do update` so a first-save race cannot silently
    // overwrite the query that won it.
    //
    // ⚠ **The target is named rather than left open.** A targetless `DO NOTHING` absorbs
    // *any* unique violation, so a constraint added to this table later would be swallowed
    // here and re-surface as a `NotifyMeQueryConflictError` telling somebody their query
    // had changed under them. Naming `(owner_id)` means only the one conflict that means
    // "you already have a query" is handled, and anything else fails loudly.
    .onConflict((conflict) => conflict.columns(['owner_id']).doNothing())
    .returningAll()
    .executeTakeFirst();
}

/**
 * Append one outbox row inside the caller's transaction.
 *
 * A local helper rather than a second port method, for
 * `postgres-bulletin.repository.ts`'s reason: the outbox row rides the same transaction
 * as the change it describes, so it has no life of its own to expose. Publishing to a
 * queue from here instead is the dual-write bug ADR-0006 exists to prevent.
 */
async function appendOutboxEvent(
  transaction: DatabaseConnection,
  event: NotifyMeQueryChanged,
): Promise<void> {
  await transaction
    .insertInto('app.outbox_events')
    .values({
      // ADR-0006 names UUID v7; PostgreSQL 17 has no `uuidv7()` and M2 adds no
      // dependency for one. v4 is a correct key — the ADR guarantees no ordering and
      // consumers must not assume any.
      event_id: randomUUID(),
      event_type: event.type,
      occurred_at: event.occurredAt,
      actor_id: event.ownerId,
      // The query is the aggregate, not the owner: consumers have routed on the query's
      // own id since D16, and #208 kept that meaning stable when it restored one query
      // per owner. The owner is still on the envelope as the actor and in the payload.
      aggregate_id: event.queryId,
      // Identifiers and routing data only — no source text, no AST. A consumer that
      // needs the query re-reads it through this module's own read path.
      payload: { ownerId: event.ownerId, version: event.version },
    })
    .execute();
}

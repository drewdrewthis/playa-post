import { randomUUID } from 'node:crypto';

import { sql, type DatabaseConnection } from '@playa-post/database';

import {
  notifyMeQueryChanged,
  notifyMeQueryCleared,
  type NotifyMeQueryChanged,
  type NotifyMeQueryCleared,
} from '../domain/notify-me-query.events';
import { SAVED_VIEW_LIMIT_PER_OWNER, type SavedView, type SavedViewListing } from '../domain/saved-view';
import {
  SavedViewConflictError,
  SavedViewLimitReachedError,
  SavedViewUnavailableError,
} from '../domain/saved-view.errors';
import type {
  DeleteSavedView,
  RenameSavedView,
  SaveSavedView,
  SavedViewRepository,
  SetSavedViewNotify,
} from '../domain/saved-view.repository';

import { toNotifyMeQuery } from './notify-me-query.mapper';
import { toSavedView } from './saved-view.mapper';

/** Everything the repository needs, injected (addendum §12). */
export interface PostgresSavedViewRepositoryDependencies {
  /** Connected as `app_rw` and nothing else (ADR-0002 §2). */
  readonly database: DatabaseConnection;
}

/**
 * `app.saved_views`, plus the one column of `app.notify_me_queries` that says which of
 * them the bell is lit on.
 *
 * **This is the only file allowed to name `app.saved_views`** (addendum §19). Every
 * statement is schema-qualified per ADR-0002's pooler-safety rules, and **every statement
 * that touches a row carries `owner_id = <actor>` in its `WHERE`** — that predicate, not a
 * prior read, is what makes M5-AC16 true: an actor naming somebody else's view matches
 * nothing, so "it is not yours" and "it does not exist" are the same query result and
 * therefore cannot be told apart from the answer.
 *
 * ⚠ It also writes `app.notify_me_queries` and `app.outbox_events`. Neither is a layering
 * slip: the designation spans both product tables as one transactional truth (see
 * {@link SavedViewRepository}), and a state change and its event are one fact
 * (addendum §10, ADR-0006). `postgres-notify-me-query.repository.ts` remains the owner of
 * the *query* itself — this file only ever moves or clears the **designation**, and never
 * writes a `source_text` the caller supplied.
 */
export function createPostgresSavedViewRepository(
  dependencies: PostgresSavedViewRepositoryDependencies,
): SavedViewRepository {
  const { database } = dependencies;

  return {
    async listFor(ownerId: string): Promise<SavedViewListing> {
      // Concurrent, because neither read informs the other. They are still one answer:
      // see `SavedViewListing` for why the two facts are not two procedures.
      const [rows, designation] = await Promise.all([
        database
          .selectFrom('app.saved_views')
          .selectAll()
          .where('owner_id', '=', ownerId)
          // Oldest first — the comp lists views in the order they were saved, and a
          // stable order is what stops a card moving under a thumb between renders.
          // `id` breaks a tie so two views saved in the same millisecond do not swap.
          .orderBy('created_at', 'asc')
          .orderBy('id', 'asc')
          .execute(),
        database
          .selectFrom('app.notify_me_queries')
          // `source_text` is not selected: this read answers "which card's bell is lit",
          // and the query text is already on the view row it points at.
          .select('source_view_id')
          .where('owner_id', '=', ownerId)
          .executeTakeFirst(),
      ]);

      return {
        views: rows.map(toSavedView),
        notifyingViewId: designation?.source_view_id ?? null,
      };
    },

    async save(write: SaveSavedView): Promise<SavedView> {
      return database.transaction().execute(async (transaction) => {
        const saved = await transaction
          .selectFrom('app.saved_views')
          .select(({ fn }) => fn.countAll<string>().as('count'))
          .where('owner_id', '=', write.ownerId)
          .executeTakeFirstOrThrow();

        if (Number(saved.count) >= SAVED_VIEW_LIMIT_PER_OWNER) {
          throw new SavedViewLimitReachedError();
        }

        const row = await transaction
          .insertInto('app.saved_views')
          .values({
            owner_id: write.ownerId,
            name: write.name,
            source_text: write.sourceText,
            ast: astColumn(write),
            ast_version: write.astVersion,
            created_at: write.createdAt,
            // Equal on insert, so "never renamed" reads as `created_at === updated_at`
            // rather than as a null a later reader has to interpret.
            updated_at: write.createdAt,
          })
          .returningAll()
          .executeTakeFirstOrThrow();

        return toSavedView(row);
      });
    },

    async rename(write: RenameSavedView): Promise<SavedView> {
      // One statement, no transaction: nothing else is written, so there is no second
      // fact to keep atomic with it. Ownership and version are both predicates on this
      // one `UPDATE`, which is what settles actorship before version comparison with no
      // ordering for a later edit to get wrong (ADR-0005 precedence rule 1).
      const row = await database
        .updateTable('app.saved_views')
        .set({
          name: write.name,
          version: sql<number>`version + 1`,
          updated_at: write.renamedAt,
        })
        .where('id', '=', write.viewId)
        .where('owner_id', '=', write.ownerId)
        .where('version', '=', write.expectedVersion)
        .returningAll()
        .executeTakeFirst();

      if (row === undefined) {
        // Deliberately incurious about which predicate failed. Re-reading to tell "wrong
        // version" from "not your view" would answer, for an actor who owns nothing,
        // whether somebody else's view carries the version they guessed.
        throw new SavedViewConflictError();
      }

      return toSavedView(row);
    },

    async delete(write: DeleteSavedView): Promise<boolean> {
      return database.transaction().execute(async (transaction) => {
        // ⚠ First, and not optional: `notify_me_queries_source_view_fkey` refuses the
        // delete below while a designation still points here. That refusal is the
        // backstop — the reason this clear happens at all is that the bell which turned
        // the notifications on is about to stop existing.
        const cleared = await transaction
          .deleteFrom('app.notify_me_queries')
          .where('owner_id', '=', write.ownerId)
          .where('source_view_id', '=', write.viewId)
          .executeTakeFirst();

        const removed = await transaction
          .deleteFrom('app.saved_views')
          .where('id', '=', write.viewId)
          .where('owner_id', '=', write.ownerId)
          .executeTakeFirst();

        if (cleared.numDeletedRows > 0n) {
          await appendOutboxEvent(
            transaction,
            notifyMeQueryCleared(write.ownerId, write.deletedAt),
          );
        }

        return removed.numDeletedRows > 0n;
      });
    },

    async setNotify(write: SetSavedViewNotify): Promise<string | null> {
      return database.transaction().execute(async (transaction) => {
        // ⚠ **Read first, for both directions of the switch**, and scoped to the actor.
        // Skipping this on the `notify: false` path would make the same procedure answer
        // differently for the same unowned id depending on a boolean — succeed silently
        // when turning off, refuse when turning on. Neither answer is an oracle on its
        // own (an invented id and somebody else's get the identical reply either way),
        // but one procedure with two not-found semantics is a seam a later edit gets
        // wrong. `views.saved.delete` is the deliberate exception and says why.
        const view = await transaction
          .selectFrom('app.saved_views')
          .select(['source_text', 'ast', 'ast_version'])
          .where('id', '=', write.viewId)
          .where('owner_id', '=', write.ownerId)
          .executeTakeFirst();

        if (view === undefined) {
          throw new SavedViewUnavailableError();
        }

        if (!write.notify) {
          const cleared = await transaction
            .deleteFrom('app.notify_me_queries')
            .where('owner_id', '=', write.ownerId)
            // Scoped to *this* view, not merely to the owner: a stale client clearing a
            // bell that has already moved must not switch off the notifications the
            // owner just turned on somewhere else.
            .where('source_view_id', '=', write.viewId)
            .executeTakeFirst();

          if (cleared.numDeletedRows === 0n) {
            return currentDesignation(transaction, write.ownerId);
          }

          await appendOutboxEvent(
            transaction,
            notifyMeQueryCleared(write.ownerId, write.changedAt),
          );

          return null;
        }

        // ⚠ The stored AST is copied across verbatim rather than re-parsed from
        // `source_text`. Re-parsing would let a grammar change silently reinterpret a
        // saved query at designation time — the exact failure `ast_version` exists to
        // prevent (ADR-0007:70-72). A view stored under an older grammar therefore keeps
        // its own `ast_version` here and is excluded from evaluation until its migration
        // runs, which is the honest behaviour rather than a guess.
        const designated = await transaction
          .insertInto('app.notify_me_queries')
          .values({
            owner_id: write.ownerId,
            source_text: view.source_text,
            ast: view.ast,
            ast_version: view.ast_version,
            updated_at: write.changedAt,
            source_view_id: write.viewId,
          })
          // D1, as one statement: the owner already having a Notify Me query is not a
          // conflict to refuse but the very case the bell exists for — the designation
          // MOVES. `notify_me_queries` (unqualified) is PostgreSQL's alias for the
          // insert target inside `DO UPDATE`, and names the row already stored.
          .onConflict((conflict) =>
            conflict.column('owner_id').doUpdateSet({
              source_text: view.source_text,
              ast: view.ast,
              ast_version: view.ast_version,
              updated_at: write.changedAt,
              source_view_id: write.viewId,
              // Bumped so a client holding a stale `expectedVersion` cannot overwrite a
              // designation it never saw through `views.notifyMe.update` (ADR-0005:98).
              version: sql<number>`notify_me_queries.version + 1`,
            }),
          )
          .returningAll()
          .executeTakeFirstOrThrow();

        await appendOutboxEvent(transaction, notifyMeQueryChanged(toNotifyMeQuery(designated)));

        return write.viewId;
      });
    },
  };
}

/**
 * Which view this owner's bell is currently lit on, if any.
 *
 * Used only on the "nothing was mine to clear" path, so a client that raced a
 * designation is told where the bell actually is rather than being told `null` and
 * rendering every card dark.
 */
async function currentDesignation(
  transaction: DatabaseConnection,
  ownerId: string,
): Promise<string | null> {
  const row = await transaction
    .selectFrom('app.notify_me_queries')
    .select('source_view_id')
    .where('owner_id', '=', ownerId)
    .executeTakeFirst();

  return row?.source_view_id ?? null;
}

/**
 * The AST as the generated `jsonb` column type wants it.
 *
 * `types`/`text` are copied into mutable arrays because kysely-codegen's `Json` has
 * mutable arrays. Nothing about the value changes; this is a variance cast with a runtime
 * copy, the same one `postgres-notify-me-query.repository.ts` makes.
 */
function astColumn(write: SaveSavedView): { types: string[]; text: string[] } {
  return { types: [...write.query.types], text: [...write.query.text] };
}

/**
 * Append one outbox row inside the caller's transaction.
 *
 * A local helper rather than a second port method, for
 * `postgres-notify-me-query.repository.ts`'s reason: the outbox row rides the same
 * transaction as the change it describes, so it has no life of its own to expose.
 */
async function appendOutboxEvent(
  transaction: DatabaseConnection,
  event: NotifyMeQueryChanged | NotifyMeQueryCleared,
): Promise<void> {
  await transaction
    .insertInto('app.outbox_events')
    .values({
      // ADR-0006 names UUID v7; PostgreSQL 17 has no `uuidv7()` and this milestone adds
      // no dependency for one. v4 is a correct key — the ADR guarantees no ordering.
      event_id: randomUUID(),
      event_type: event.type,
      occurred_at: event.occurredAt,
      actor_id: event.ownerId,
      // The owner is the aggregate: one Notify Me query per user is the primary key
      // (D1, ADR-0007:79), so there is no separate query ID to route on — and
      // deliberately not the view id, which would make two events about the same
      // person's single query route to two different aggregates.
      aggregate_id: event.ownerId,
      // Identifiers and routing data only — no name, no source text, no AST. A saved
      // view is a statement about what a person is interested in, which is exactly what
      // an outbox row must not leave lying around in a log (ADR-0006, M2-AC16).
      payload: { ownerId: event.ownerId },
    })
    .execute();
}

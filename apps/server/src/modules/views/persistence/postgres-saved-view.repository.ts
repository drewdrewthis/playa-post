import { randomUUID } from 'node:crypto';

import { sql, type DatabaseConnection } from '@playa-post/database';

import { NOTIFY_ME_QUERY_LIMIT_PER_OWNER } from '../domain/notify-me-query';
import { NotifyMeQueryLimitReachedError } from '../domain/notify-me-query.errors';
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
 * them have a bell lit.
 *
 * **This is the only file allowed to name `app.saved_views`** (addendum §19). Every
 * statement is schema-qualified per ADR-0002's pooler-safety rules, and **every statement
 * that touches a row carries `owner_id = <actor>` in its `WHERE`** — that predicate, not a
 * prior read, is what makes M5-AC16 true: an actor naming somebody else's view matches
 * nothing, so "it is not yours" and "it does not exist" are the same query result and
 * therefore cannot be told apart from the answer.
 *
 * ⚠ It also writes `app.notify_me_queries` and `app.outbox_events`. Neither is a layering
 * slip: a designation spans both product tables as one transactional truth (see
 * {@link SavedViewRepository}), and a state change and its event are one fact
 * (addendum §10, ADR-0006). `postgres-notify-me-query.repository.ts` remains the owner of
 * the **untied** query — the one row per person that belongs to no view; this file owns
 * the rows behind the bells, and never writes a `source_text` the caller supplied.
 *
 * ⚠ **Every statement here that touches `app.notify_me_queries` carries BOTH `owner_id`
 * and `source_view_id`, and after D16 the second predicate is load-bearing rather than
 * redundant.** While there was one row per owner, scoping to the owner selected the same
 * single row whatever else was written; a person may now hold several, so a statement
 * missing its `source_view_id` would silently reach every bell they have lit.
 *
 * ⚠ **And every statement here that touches `app.saved_views` carries
 * `deleted_at is null`** (issue #169). Deleting a view is a soft delete, so the row a
 * person removed is still on the table and every one of these five statements would find
 * it: the list would render it, the cap would count it, a rename would revive it under a
 * new name, and `setNotify` would light a bell on a card nobody can see. This being the
 * only file allowed to name the table is what makes that one predicate in five places
 * rather than a rule spread across the codebase — and it is why there is no
 * `deleted_at is null` anywhere else to forget.
 */
export function createPostgresSavedViewRepository(
  dependencies: PostgresSavedViewRepositoryDependencies,
): SavedViewRepository {
  const { database } = dependencies;

  return {
    async listFor(ownerId: string): Promise<SavedViewListing> {
      // Concurrent, because neither read informs the other. They are still one answer:
      // see `SavedViewListing` for why the two facts are not two procedures.
      const [rows, designations] = await Promise.all([
        database
          .selectFrom('app.saved_views')
          .selectAll()
          .where('owner_id', '=', ownerId)
          .where('deleted_at', 'is', null)
          // Oldest first — the comp lists views in the order they were saved, and a
          // stable order is what stops a card moving under a thumb between renders.
          // `id` breaks a tie so two views saved in the same millisecond do not swap.
          .orderBy('created_at', 'asc')
          .orderBy('id', 'asc')
          .execute(),
        designatedViewIds(database, ownerId),
      ]);

      return { views: rows.map(toSavedView), notifyingViewIds: designations };
    },

    async save(write: SaveSavedView): Promise<SavedView> {
      return database.transaction().execute(async (transaction) => {
        const saved = await transaction
          .selectFrom('app.saved_views')
          .select(({ fn }) => fn.countAll<string>().as('count'))
          .where('owner_id', '=', write.ownerId)
          // The cap bounds the list somebody can see, so it counts the rows that are on
          // it. Counting soft-deleted rows too would let a person exhaust their own cap
          // by deleting views, and leave them at a refusal telling them to remove one —
          // pointing at cards none of which would free a slot for up to thirty days.
          .where('deleted_at', 'is', null)
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
        // A deleted view is not renameable, and this predicate is what makes that a
        // property of the statement rather than of whichever caller read the list first.
        // Without it a client holding a stale list could rename a view out of its own
        // deletion, and the row would come back to the Saved screen (#169).
        .where('deleted_at', 'is', null)
        .returningAll()
        .executeTakeFirst();

      if (row === undefined) {
        // Deliberately incurious about which predicate failed. Re-reading to tell "wrong
        // version" from "not your view" would answer, for an actor who owns nothing,
        // whether somebody else's view carries the version they guessed. A view this
        // owner deleted answers the same way, which is the honest reading of a rename
        // aimed at something that is not there.
        throw new SavedViewConflictError();
      }

      return toSavedView(row);
    },

    async delete(write: DeleteSavedView): Promise<boolean> {
      return database.transaction().execute(async (transaction) => {
        // ⚠ **The designation is still deleted outright, and only the view is softened**
        // (issue #169). A soft delete is about being able to recover a person's own
        // content and about giving a purge something finite to remove; a Notify Me query
        // is neither — it is a live instruction to push notifications at somebody, and
        // leaving one stamped `deleted_at` on a table nothing filters would keep sending
        // them. The bell that switched them on lived on the card that is now gone, so
        // there is no surface left to reach it from.
        //
        // The FK is no longer what forces this order — a soft-deleted view row still
        // satisfies `notify_me_queries_source_view_fkey` — which is exactly why it is
        // written here as the deliberate act it always was rather than left to a
        // constraint that would now stay silent.
        //
        // `returning('id')` rather than a row count, because the event has to name the
        // query that went (D16) and the only honest source for that is the statement that
        // removed it.
        const cleared = await transaction
          .deleteFrom('app.notify_me_queries')
          .where('owner_id', '=', write.ownerId)
          .where('source_view_id', '=', write.viewId)
          .returning('id')
          .executeTakeFirst();

        // ⚠ **An UPDATE that reads exactly like the DELETE it replaced.** The `owner_id`
        // predicate is still what makes M5-AC16 true, and `deleted_at is null` is what
        // keeps the operation idempotent now that the row survives it: a second delete
        // matches nothing and answers `false`, exactly as it did when the first one took
        // the row away. Both cases — already deleted, never yours — remain one answer,
        // which is the anti-oracle property `DeleteSavedViewService` documents.
        const removed = await transaction
          .updateTable('app.saved_views')
          .set({ deleted_at: write.deletedAt })
          .where('id', '=', write.viewId)
          .where('owner_id', '=', write.ownerId)
          .where('deleted_at', 'is', null)
          .executeTakeFirst();

        if (cleared !== undefined) {
          await appendOutboxEvent(
            transaction,
            notifyMeQueryCleared(write.ownerId, cleared.id, write.deletedAt),
          );
        }

        return removed.numUpdatedRows > 0n;
      });
    },

    async setNotify(write: SetSavedViewNotify): Promise<readonly string[]> {
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
          // A deleted view has no card, so it has no bell — in either direction. Without
          // this predicate `notify: true` would designate a query nothing on screen could
          // ever switch off again, and the FK would not object, because the row is still
          // there (#169).
          .where('deleted_at', 'is', null)
          .executeTakeFirst();

        if (view === undefined) {
          // The same refusal a view id naming nothing gets, and now also the one a view
          // this owner deleted gets. Three cases, one answer (M5-AC16).
          throw new SavedViewUnavailableError();
        }

        if (!write.notify) {
          const cleared = await transaction
            .deleteFrom('app.notify_me_queries')
            .where('owner_id', '=', write.ownerId)
            // ⚠ Scoped to *this* view, and under D16 that predicate is the whole
            // independence guarantee (#172 AC2): without it, switching one bell off
            // switches off every bell this person has lit. It was already required
            // before — a stale client clearing a bell that had moved must not undo a live
            // choice — but a single row per owner meant dropping it cost nothing in the
            // common case. It now costs everything.
            .where('source_view_id', '=', write.viewId)
            .returning('id')
            .executeTakeFirst();

          // Nothing of this owner's matched means nothing was switched off, and nothing may
          // claim it was: a spurious `NotifyMeQueryCleared` is what a downstream consumer
          // would act on to stop sending.
          if (cleared !== undefined) {
            await appendOutboxEvent(
              transaction,
              notifyMeQueryCleared(write.ownerId, cleared.id, write.changedAt),
            );
          }

          // Either way the caller is told where their bells actually are, so a client that
          // raced another device is corrected rather than told "none".
          return designatedViewIds(transaction, write.ownerId);
        }

        // ⚠ **The cap counts bells, and nothing else.** `designatedViewIds` excludes the
        // untied query `views.notifyMe.update` writes, so six means six *cards* — counting
        // every row of this owner's instead would silently spend a bell slot on a query
        // that is on no card, and then refuse the sixth bell with a message telling
        // somebody to switch one off when none of the ones they can see would free it. The
        // untied row is capped at one by the unique key and needs no count of its own.
        //
        // It is checked here and not on the `notify: false` path, and only for a bell that
        // is not already lit: only a write that *adds* a row has anything to answer for,
        // and re-lighting a lit bell is an upsert onto the row that is already there. That
        // must stay a no-op rather than becoming a refusal somebody meets by tapping twice.
        //
        // Read inside this transaction and unlocked, which is the cap's stated trade (see
        // the constant): two taps racing each other can land one extra row.
        const lit = await designatedViewIds(transaction, write.ownerId);

        if (!lit.includes(write.viewId) && lit.length >= NOTIFY_ME_QUERY_LIMIT_PER_OWNER) {
          throw new NotifyMeQueryLimitReachedError();
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
          // ⚠ **The conflict target is `(owner_id, source_view_id)`, which is D16 replacing
          // D1 in one line.** It used to be `owner_id` alone, and the upsert's meaning was
          // "the designation MOVES"; the pair means "this view's bell", so lighting a
          // second one adds a query and lighting the same one twice converges. Re-lighting
          // is the only case that reaches `DO UPDATE`, and it refreshes the copied query
          // text — a view whose card was renamed still notifies on its own query, but a
          // view saved before a grammar migration picks up nothing it did not already
          // have. `notify_me_queries` (unqualified) is PostgreSQL's alias for the insert
          // target inside `DO UPDATE`, and names the row already stored.
          .onConflict((conflict) =>
            conflict.columns(['owner_id', 'source_view_id']).doUpdateSet({
              source_text: view.source_text,
              ast: view.ast,
              ast_version: view.ast_version,
              updated_at: write.changedAt,
              // Bumped so a client holding a stale `expectedVersion` cannot overwrite a
              // designation it never saw (ADR-0005:98).
              version: sql<number>`notify_me_queries.version + 1`,
            }),
          )
          .returningAll()
          .executeTakeFirstOrThrow();

        await appendOutboxEvent(transaction, notifyMeQueryChanged(toNotifyMeQuery(designated)));

        return designatedViewIds(transaction, write.ownerId);
      });
    },
  };
}

/**
 * Every view this owner's bells are currently lit on.
 *
 * ⚠ **The single answer `listFor` and `setNotify` give, and the set the cap counts**,
 * deliberately one function rather than a query written at each call site: they are the
 * surfaces a client uses to decide which cards are lit, and two spellings of "which bells
 * are on" would be two chances to forget the `owner_id` predicate or the `NOT NULL` filter
 * — or, worse, to answer one question with a set the other was not counting.
 *
 * The untied query is excluded by `source_view_id is not null` — it belongs to no view and
 * therefore appears on no card's bell, exactly as it did when there was only one query.
 * That exclusion is why {@link NOTIFY_ME_QUERY_LIMIT_PER_OWNER} can read this directly:
 * the cap bounds bells, and this is the bells.
 *
 * Ordered so that two reads of unchanged state serialize identically. Nothing renders it
 * as a sequence; the order carries no meaning beyond that.
 */
async function designatedViewIds(
  connection: DatabaseConnection,
  ownerId: string,
): Promise<readonly string[]> {
  const rows = await connection
    .selectFrom('app.notify_me_queries')
    // `source_text` is not selected: this read answers "which cards' bells are lit", and
    // each query's text is already on the view row it points at.
    .select('source_view_id')
    .where('owner_id', '=', ownerId)
    .where('source_view_id', 'is not', null)
    .orderBy('source_view_id', 'asc')
    .execute();

  // The `is not null` predicate is a fact about the rows, not about the column type, so
  // the compiler still has these as nullable. Narrowed rather than asserted.
  return rows.flatMap((row) => (row.source_view_id === null ? [] : [row.source_view_id]));
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
      // The query is the aggregate (D16), and deliberately still not the *view* id: the
      // designation and the query it carries are one row with one lifetime, and routing on
      // the view would make an untied query — which has no view — unroutable by the same
      // rule. `postgres-notify-me-query.repository.ts` writes the identical field.
      aggregate_id: event.queryId,
      // Identifiers and routing data only — no name, no source text, no AST. A saved
      // view is a statement about what a person is interested in, which is exactly what
      // an outbox row must not leave lying around in a log (ADR-0006, M2-AC16).
      payload: { ownerId: event.ownerId },
    })
    .execute();
}

import type { DatabaseConnection } from '@playa-post/database';

import type { DeletedSavedViewsRepository } from '../application/deleted-saved-views.repository';

/** Everything the repository needs, injected (addendum §12). */
export interface PostgresDeletedSavedViewsRepositoryDependencies {
  /** Connected as `app_rw` and nothing else (ADR-0002 §2). */
  readonly database: DatabaseConnection;
}

/**
 * The retention sweep over `app.saved_views` (issue #169).
 *
 * A second file rather than a sixth method on
 * `postgres-saved-view.repository.ts`, for the reason
 * {@link DeletedSavedViewsRepository} gives: that file's stated invariant is that
 * **every** statement in it names an owner, and this one names none.
 *
 * ⚠ **Unbounded — no `LIMIT`, and that is a choice with a stated trigger.** One `DELETE`
 * is simpler than the `where id in (select … limit n)` PostgreSQL needs for a bounded
 * one, and the rows it touches are a table nothing else reads: every other statement over
 * `app.saved_views` filters `deleted_at is null`, so the locks this takes are on rows no
 * request can be waiting for. The bound to add — if a first sweep against a long-running
 * deployment ever proves slow enough to matter — is a batch size here, not a shorter
 * window; the sweep re-runs hourly and is idempotent, so a partial pass is simply
 * finished by the next one.
 */
export function createPostgresDeletedSavedViewsRepository(
  dependencies: PostgresDeletedSavedViewsRepositoryDependencies,
): DeletedSavedViewsRepository {
  const { database } = dependencies;

  return {
    async purge(deletedBefore: Date): Promise<number> {
      return database.transaction().execute(async (transaction) => {
        // ⚠ **A backstop, and it should always match zero rows.**
        // `SavedViewRepository#delete` deletes a view's Notify Me designation outright in
        // the same transaction that soft-deletes the view, and no path can designate a
        // view that is already deleted — `setNotify` filters `deleted_at is null`. So the
        // invariant is "a deleted view has no designation", and this statement is what
        // stops a future edit that breaks it from wedging the sweep: a surviving
        // designation would make `notify_me_queries_source_view_fkey` refuse the `DELETE`
        // below, every hour, forever, and a purge that throws every round looks exactly
        // like one with nothing to do.
        //
        // The FK used to enforce the ordering on its own, because the view row went away.
        // It cannot any more — a soft-deleted row still satisfies it — which is precisely
        // why the guarantee needs writing down twice.
        //
        // Silent when it does fire, with no `NotifyMeQueryCleared`: the bell has been
        // off a card nobody could see for the whole retention window, so there is no
        // present-tense fact for a consumer to act on, and the purge announces nothing by
        // design (see this module's decision record, D17).
        await transaction
          .deleteFrom('app.notify_me_queries')
          .where('source_view_id', 'in', (eb) =>
            eb.selectFrom('app.saved_views').select('id').where('deleted_at', '<', deletedBefore),
          )
          .execute();

        const purged = await transaction
          .deleteFrom('app.saved_views')
          // `NULL < deletedBefore` is unknown, never true, so a view nobody deleted is
          // structurally unreachable here — the sweep cannot be pointed at live data by
          // moving the cutoff.
          .where('deleted_at', '<', deletedBefore)
          .executeTakeFirst();

        return Number(purged.numDeletedRows);
      });
    },
  };
}

import type { DatabaseConnection } from '@playa-post/database';

import type { RemovedBulletinsRepository } from '../application/removed-bulletins.repository';

/** Everything the repository needs, injected (addendum §12). */
export interface PostgresRemovedBulletinsRepositoryDependencies {
  /** Connected as `app_rw` and nothing else (ADR-0002 §2). */
  readonly database: DatabaseConnection;
}

/**
 * The retention sweep over `app.bulletins` (issue #169).
 *
 * A second file rather than a method on `postgres-bulletin.repository.ts`, matching
 * `postgres-deleted-saved-views.repository.ts`: that file is the author's own rows and
 * the §6a-projected authorized set, both addressed by somebody, and this is addressed by
 * a clock.
 *
 * ⚠ **One statement, no transaction, and the cascade is the rest of it.** A single
 * `DELETE` is already atomic, and the reports and dismissals that would otherwise refuse
 * it are removed by `ON DELETE CASCADE` on `app.bulletin_reports` and
 * `app.bulletin_dismissals` — declared in `20260812150000_soft_delete_and_purge.sql`,
 * because those are `modules/moderation`'s tables and a statement here naming them would
 * be the cross-module reach-in addendum §19 forbids.
 *
 * ⚠ Unbounded, deliberately, on the same terms
 * `postgres-deleted-saved-views.repository.ts` records — and the trigger for revisiting
 * is more likely here, this being the largest table the product grows.
 *
 * ⚠ **It leaves rows that merely mention a bulletin id, and that is correct rather than
 * overlooked.** `app.outbox_events.aggregate_id` carries the id of the bulletin an event
 * is about, and `app.mutation_results` echoes one back to a replaying client — neither
 * has a foreign key, both by their own deliberate design. By the time a row reaches this
 * sweep it has been removed for the whole retention window, so any `BulletinCreated` or
 * `BulletinArchived` naming it was published (or dead-lettered) a month ago and is past
 * ADR-0006's own fourteen-day prune besides; a consumer that re-read one would find
 * nothing, which is the same answer it already gets for a bulletin outside its authorized
 * set. Widening this sweep to hunt those rows would be a statement here naming
 * infrastructure tables no module owns, for orphans that cost a row apiece — the trade
 * `app.notification_dismissals` already made explicitly.
 */
export function createPostgresRemovedBulletinsRepository(
  dependencies: PostgresRemovedBulletinsRepositoryDependencies,
): RemovedBulletinsRepository {
  const { database } = dependencies;

  return {
    async purge(removedBefore: Date): Promise<number> {
      const purged = await database
        .deleteFrom('app.bulletins')
        // `archived_at`, never `expires_at`, and never both: an elapsed expiry is not
        // something its author did. `NULL < removedBefore` is unknown rather than true,
        // so a live bulletin is structurally unreachable here however far back the cutoff
        // is moved.
        .where('archived_at', '<', removedBefore)
        .executeTakeFirst();

      return Number(purged.numDeletedRows);
    },
  };
}

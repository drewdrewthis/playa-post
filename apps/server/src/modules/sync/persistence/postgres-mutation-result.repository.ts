import type { Database, DatabaseConnection, Insertable } from '@playa-post/database';

import type {
  MutationResultRepository,
  NewMutationResult,
  StoredMutationResult,
} from '../domain/mutation-result.repository';

/** Everything the repository needs, injected (addendum §12). */
export interface PostgresMutationResultRepositoryDependencies {
  /** Connected as `app_rw` and nothing else (ADR-0002 §2). */
  readonly database: DatabaseConnection;
}

/**
 * The generated type of the `jsonb` column, named once.
 *
 * `NewMutationResult.result` is `unknown` because a handler's result is whatever the
 * owning module returns, and the port must not force every module's read model through
 * a JSON type it does not own. The narrowing happens here, at the one place that knows
 * the column — a cast rather than a parse, because the value has already been through
 * the wire and is JSON by construction.
 */
type MutationResultColumn = Insertable<Database['app.mutation_results']>['result'];

/**
 * `app.mutation_results`, behind {@link MutationResultRepository}.
 *
 * Every statement is schema-qualified (`app.mutation_results`, never
 * `mutation_results`) per ADR-0002's pooler-safety rules: with `search_path` outside
 * this file's control, an unqualified name is a silent cross-schema read waiting for a
 * `public.mutation_results` to exist.
 *
 * ⚠ This repository writes **no outbox row**, unlike `modules/bulletins`' and
 * `modules/connections`'. An idempotency record is bookkeeping about a mutation, not a
 * fact about the world — the effect's own repository already announced whatever
 * happened, and a second event here would deliver every state change twice.
 */
export function createPostgresMutationResultRepository(
  dependencies: PostgresMutationResultRepositoryDependencies,
): MutationResultRepository {
  const { database } = dependencies;

  return {
    async findByActorAndMutationId(
      actorId: string,
      mutationId: string,
    ): Promise<StoredMutationResult | null> {
      // Both predicates, always. `mutation_id` alone is the primary key and would
      // answer "that id exists" for an id the caller chose — ADR-0005 requires the
      // lookup to be namespaced by `actor_id`, and the composite index exists for
      // exactly this statement.
      const row = await database
        .selectFrom('app.mutation_results')
        .select(['mutation_type', 'request_hash', 'result'])
        .where('actor_id', '=', actorId)
        .where('mutation_id', '=', mutationId)
        .executeTakeFirst();

      return row === undefined
        ? null
        : {
            mutationType: row.mutation_type,
            requestHash: row.request_hash,
            result: row.result,
          };
    },

    async save(record: NewMutationResult): Promise<void> {
      await database
        .insertInto('app.mutation_results')
        .values({
          mutation_id: record.mutationId,
          actor_id: record.actorId,
          mutation_type: record.mutationType,
          request_hash: record.requestHash,
          outcome: record.outcome,
          result: record.result as MutationResultColumn,
          // `created_at` is left to the column default, which is the one timestamp in
          // this schema that has one (ADR-0005's schema block specifies it): it is a
          // retention-window bookkeeping stamp, not a product fact a writer states.
        })
        // Two concurrent submissions of one envelope both apply their effect and both
        // arrive here. The first row stands; the second must not fail a request it has
        // already served, and must not overwrite the result the first one returned.
        .onConflict((onConflict) => onConflict.column('mutation_id').doNothing())
        .execute();
    },
  };
}

import type { DatabaseConnection } from '@playa-post/database';

import type {
  ConnectionTrustRepository,
  TrustAssignment,
} from '../domain/connection-trust.repository';

/** Everything the repository needs, injected (addendum §12). */
export interface PostgresConnectionTrustRepositoryDependencies {
  /** Connected as `app_rw` and nothing else (ADR-0002 §2). */
  readonly database: DatabaseConnection;
}

/**
 * `app.connection_trust`, behind the domain's {@link ConnectionTrustRepository} port.
 *
 * ⚠ **Every statement here is keyed on `owner_id` first, and none of them can be
 * written otherwise** — there is no method taking only a subject or only a connection.
 * ADR-0002 B6 requires a trust value never to leave its holder, and this table exists
 * separately from `app.connections` so that a query which forgets to join has nothing
 * to leak rather than something to remember to strip (ratified decision (b)).
 */
export function createPostgresConnectionTrustRepository(
  dependencies: PostgresConnectionTrustRepositoryDependencies,
): ConnectionTrustRepository {
  const { database } = dependencies;

  return {
    async findOwn(ownerId: string, subjectId: string): Promise<number | null> {
      const row = await database
        .selectFrom('app.connection_trust')
        .select('trust')
        .where('owner_id', '=', ownerId)
        .where('subject_id', '=', subjectId)
        .executeTakeFirst();

      // Two different absences collapse to the same answer on purpose. No row is
      // `unset` under this lane's ratified model; a row whose column is NULL is the
      // shape ADR-0004:70-71 mandates and would mean the same thing. Neither is `0`,
      // which is a value somebody chose (M2-AC4).
      return row?.trust ?? null;
    },

    async set(assignment: TrustAssignment): Promise<void> {
      // An upsert, because an opinion has one current value: setting 85 twice is one
      // opinion, not two rows and not a race between an insert and an update. The
      // (owner_id, subject_id) primary key is what makes it a single statement.
      await database
        .insertInto('app.connection_trust')
        .values({
          owner_id: assignment.ownerId,
          subject_id: assignment.subjectId,
          trust: assignment.trust,
          updated_at: assignment.assignedAt,
        })
        .onConflict((onConflict) =>
          onConflict.columns(['owner_id', 'subject_id']).doUpdateSet({
            trust: assignment.trust,
            updated_at: assignment.assignedAt,
          }),
        )
        .execute();
    },
  };
}

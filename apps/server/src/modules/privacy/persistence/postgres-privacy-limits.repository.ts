import type { DatabaseConnection } from '@playa-post/database';

import type { PrivacyLimits } from '../domain/privacy-limits';
import type {
  PrivacyLimitsAssignment,
  PrivacyLimitsRepository,
} from '../domain/privacy-limits.repository';

/** Everything the repository needs, injected (addendum §12). */
export interface PostgresPrivacyLimitsRepositoryDependencies {
  /** Connected as `app_rw` and nothing else (ADR-0002 §2). */
  readonly database: DatabaseConnection;
}

/**
 * `app.privacy_settings`, behind the domain's {@link PrivacyLimitsRepository} port.
 *
 * ⚠ **This repository is a write path and an owner's-own read path, and nothing else.**
 * Enforcement of the name limit lives in `app.visible_people` (ADR-0002 §6a), which
 * reads the table directly through its allowlisted grant. Adding a "does this policy
 * admit that viewer" method here would be a second implementation of a rule that must
 * have exactly one.
 */
export function createPostgresPrivacyLimitsRepository(
  dependencies: PostgresPrivacyLimitsRepositoryDependencies,
): PrivacyLimitsRepository {
  const { database } = dependencies;

  return {
    async findOwn(ownerId: string): Promise<PrivacyLimits | null> {
      const row = await database
        .selectFrom('app.privacy_settings')
        .select(['name_min_trust', 'name_max_degree', 'note_min_trust', 'note_max_degree'])
        .where('user_id', '=', ownerId)
        .executeTakeFirst();

      if (row === undefined) {
        return null;
      }

      return {
        name: { minTrust: row.name_min_trust, maxDegree: row.name_max_degree },
        note: { minTrust: row.note_min_trust, maxDegree: row.note_max_degree },
      };
    },

    async set(assignment: PrivacyLimitsAssignment): Promise<void> {
      // An upsert, because a policy has one current value: tightening twice is one
      // policy, not two rows and not a race between an insert and an update. The
      // `user_id` primary key is what makes it a single statement.
      //
      // ⚠ Every column is written on both branches, including the ones that did not
      // change. A partial `doUpdateSet` would let a client that sent only the name limit
      // leave a stale note limit behind, and "I set this screen the way I wanted" would
      // depend on the order the two rows were touched in.
      const values = {
        name_min_trust: assignment.limits.name.minTrust,
        name_max_degree: assignment.limits.name.maxDegree,
        note_min_trust: assignment.limits.note.minTrust,
        note_max_degree: assignment.limits.note.maxDegree,
        updated_at: assignment.assignedAt,
      };

      await database
        .insertInto('app.privacy_settings')
        .values({ user_id: assignment.ownerId, ...values })
        .onConflict((onConflict) => onConflict.column('user_id').doUpdateSet(values))
        .execute();
    },
  };
}

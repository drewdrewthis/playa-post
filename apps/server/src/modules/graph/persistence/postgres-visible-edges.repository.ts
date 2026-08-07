import { sql, type DatabaseConnection } from '@playa-post/database';

import type { ViewerId } from '../../../shared/auth/viewer-id';
import type { VisibleEdge } from '../application/visible-edge';
import type { VisibleEdgesRepository } from '../application/visible-edges.repository';

/** Everything the repository needs, injected (addendum §12). */
export interface PostgresVisibleEdgesRepositoryDependencies {
  /** Connected as `app_rw` and nothing else (ADR-0002 §2). */
  readonly database: DatabaseConnection;
}

/** One row as `app.visible_edges` returns it. */
interface VisibleEdgeRow {
  readonly person_a_id: string;
  readonly person_b_id: string;
}

/**
 * `app.visible_edges`, behind the {@link VisibleEdgesRepository} port.
 *
 * **One statement, and it is a function call** — the same shape
 * `postgres-visible-people.repository.ts` holds to, for the same reason. Every rule
 * about which pairs a viewer may see lives in `sql/visible-edges.sql`; a `join
 * app.connections` written here, even a convenient one, would be a second answer to
 * "which of my people know each other" that `sql-table-ownership` cannot see, because a
 * Kysely builder is not a `.sql` file.
 */
export function createPostgresVisibleEdgesRepository(
  dependencies: PostgresVisibleEdgesRepositoryDependencies,
): VisibleEdgesRepository {
  const { database } = dependencies;

  return {
    async findVisibleEdges(viewerId: ViewerId): Promise<readonly VisibleEdge[]> {
      // The identifier travels as a bound parameter, which is what ADR-0002 §5 means by
      // "every viewer-scoped read passes viewer_id explicitly": no session GUC, no
      // ambient state a transaction-mode pooler could hand to the wrong session.
      const { rows } = await sql<VisibleEdgeRow>`
        select person_a_id, person_b_id
          from app.visible_edges(${viewerId})
      `.execute(database);

      return rows.map((row) => ({ personAId: row.person_a_id, personBId: row.person_b_id }));
    },
  };
}

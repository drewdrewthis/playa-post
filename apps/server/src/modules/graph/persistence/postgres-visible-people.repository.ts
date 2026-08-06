import { sql, type DatabaseConnection } from '@playa-post/database';

import type { ViewerId } from '../../../shared/auth/viewer-id';
import type { VisiblePeopleRepository } from '../application/visible-people.repository';
import type { VisiblePerson } from '../application/visible-person';

import { toVisiblePerson, type VisiblePersonRow } from './visible-person.mapper';

/** Everything the repository needs, injected (addendum §12). */
export interface PostgresVisiblePeopleRepositoryDependencies {
  /** Connected as `app_rw` and nothing else (ADR-0002 §2). */
  readonly database: DatabaseConnection;
}

/**
 * `app.visible_people`, behind the {@link VisiblePeopleRepository} port.
 *
 * **One statement, and it is a function call.** Everything this module knows about
 * visibility lives in `sql/visible-people.sql`; this file's whole job is to pass the
 * viewer in and map the rows out. A `join` written here — even a convenient one, even
 * for a field the function does not return — would be the second definition of "who
 * can this viewer reach" that ADR-0002 §6 forbids and that `sql-table-ownership`
 * cannot see, because a Kysely builder is not a `.sql` file.
 *
 * `max_depth` and `node_budget` are left to the function's own defaults. They are
 * operational bounds, never a product depth cap (ADR-0004 decision 2).
 */
export function createPostgresVisiblePeopleRepository(
  dependencies: PostgresVisiblePeopleRepositoryDependencies,
): VisiblePeopleRepository {
  const { database } = dependencies;

  /**
   * The one statement, shared by both port methods.
   *
   * They differ only in what the compiler will let a caller *pass*: a branded
   * {@link ViewerId} from the request scope, or a `string` read from stored state
   * (ADR-0002 §11's delivery-time re-check). The database is handed the same bound
   * parameter either way, so there is deliberately no second query here — two spellings
   * of `app.visible_people` would be two things to keep in step.
   */
  async function project(personId: string): Promise<readonly VisiblePerson[]> {
    // The identifier travels as a bound parameter, which is what ADR-0002 §5 means by
    // "every viewer-scoped read passes viewer_id explicitly": no session GUC, no
    // ambient state a transaction-mode pooler could hand to the wrong session.
    const { rows } = await sql<VisiblePersonRow>`
      select user_id, degree, disclosure, display_name, handle, trust
        from app.visible_people(${personId})
    `.execute(database);

    return rows.map(toVisiblePerson);
  }

  return {
    findVisiblePeople: (viewerId: ViewerId): Promise<readonly VisiblePerson[]> => project(viewerId),
    findVisiblePeopleFor: (userId: string): Promise<readonly VisiblePerson[]> => project(userId),
  };
}

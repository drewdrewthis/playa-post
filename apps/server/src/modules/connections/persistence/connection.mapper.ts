import type { Database, Selectable } from '@playa-post/database';

import type { Connection } from '../domain/connection';

/**
 * One `app.connections` row as the generated schema describes it.
 *
 * Derived from `@playa-post/database`'s checked-in types rather than hand-written, so
 * a migration that changes the table breaks `pnpm typecheck` here instead of producing
 * wrong values at runtime.
 */
export type ConnectionRow = Selectable<Database['app.connections']>;

/**
 * Translate a database row into the domain's {@link Connection}.
 *
 * ⚠ There is no trust field to map, and that is structural rather than an oversight:
 * trust lives in `app.connection_trust`, so a read of this table cannot carry one even
 * if a future caller forgets that it must not (ratified decision (b), ADR-0002 B6).
 */
export function toConnection(row: ConnectionRow): Connection {
  return {
    id: row.id,
    userAId: row.user_a_id,
    userBId: row.user_b_id,
    status: row.status,
    aDisclosesToBLevel: row.a_discloses_to_b_level,
    bDisclosesToALevel: row.b_discloses_to_a_level,
    createdAt: row.created_at,
  };
}

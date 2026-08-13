import type { Database, Selectable } from '@playa-post/database';

import {
  CONNECTION_REQUEST_STATUS,
  type ConnectionRequest,
  type ConnectionRequestStatus,
} from '../domain/connection-request';

/**
 * One `app.connection_requests` row as the generated schema describes it.
 *
 * Derived from `@playa-post/database`'s checked-in types rather than hand-written, so a
 * migration that changes the table breaks `pnpm typecheck` here instead of producing wrong
 * values at runtime.
 */
export type ConnectionRequestRow = Selectable<Database['app.connection_requests']>;

/**
 * Narrow a stored status, failing **loudly**.
 *
 * ⚠ Deliberately not a fail-closed narrowing. There is no safe answer to guess: reading an
 * unknown value as `declined` would hide a live request from its owner, and reading it as
 * `pending` would offer them a decision on a row in a state nothing here understands. An
 * unrecognised value means a migration widened `connection_requests_status` without
 * updating this code — a programming mistake rather than a caller's refusal, and a 500 is
 * the honest report of it. The same call `intro-request.mapper.ts` makes.
 */
function toConnectionRequestStatus(stored: string): ConnectionRequestStatus {
  // Object.values, not `in`: the constant's *values* are the stored vocabulary.
  const known = Object.values(CONNECTION_REQUEST_STATUS).find((status) => status === stored);

  if (known === undefined) {
    throw new Error(
      'toConnectionRequestStatus: app.connection_requests.status holds an unknown value',
    );
  }

  return known;
}

/**
 * Translate a database row into the domain's {@link ConnectionRequest}.
 *
 * ⚠ `decidedAt` is **omitted, not null**, while the request is open. The database CHECK
 * `(status = 'pending') = (decided_at is null)` guarantees the two agree, and an absent key
 * is what `exactOptionalPropertyTypes` lets the compiler keep honest.
 *
 * ⚠ **A lapsed request maps like any other `pending` one, and that is correct.** Expiry is
 * not a stored fact (ADR-0018 D5), so there is nothing here to translate: the reads and the
 * gated update apply the TTL, and a mapper that quietly reported a lapsed row as something
 * else would be a second definition of "expired" living where no test looks.
 */
export function toConnectionRequest(row: ConnectionRequestRow): ConnectionRequest {
  return {
    id: row.id,
    ownerId: row.owner_id,
    requesterId: row.requester_id,
    status: toConnectionRequestStatus(row.status),
    createdAt: row.created_at,
    ...(row.decided_at === null ? {} : { decidedAt: row.decided_at }),
  };
}

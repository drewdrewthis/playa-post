import type { Database, Selectable } from '@playa-post/database';

import {
  INTRO_REQUEST_STATUS,
  type IntroRequest,
  type IntroRequestStatus,
} from '../domain/intro-request';

/**
 * One `app.intro_requests` row as the generated schema describes it.
 *
 * Derived from `@playa-post/database`'s checked-in types rather than hand-written, so a
 * migration that changes the table breaks `pnpm typecheck` here instead of producing
 * wrong values at runtime.
 */
export type IntroRequestRow = Selectable<Database['app.intro_requests']>;

/**
 * Narrow a stored status, failing **loudly**.
 *
 * ⚠ Deliberately not the fail-closed narrowing
 * {@link import('../../identity/domain/visible-to-distance').toVisibleToDistance} does.
 * That one collapses an unknown *privacy* setting to the most private value, because
 * there is a safe answer. There is no safe answer here: guessing `declined` would hide a
 * live request and guessing `passed_on` would disclose one, so an unrecognised value is a
 * migration that widened `intro_requests_status` without updating this code — a
 * programming mistake, not a caller's refusal, and a 500 is the honest report of it.
 */
function toIntroRequestStatus(stored: string): IntroRequestStatus {
  // Object.values, not `in`: the constant's *values* are the stored vocabulary, and its
  // keys (`passedOn`) deliberately are not.
  const known = Object.values(INTRO_REQUEST_STATUS).find((status) => status === stored);

  if (known === undefined) {
    throw new Error('toIntroRequestStatus: app.intro_requests.status holds an unknown value');
  }

  return known;
}

/**
 * Translate a database row into the domain's {@link IntroRequest}.
 *
 * ⚠ `decidedAt` is **omitted, not null**, while the request is open. The database CHECK
 * `(status = 'requested') = (decided_at is null)` guarantees the two agree, and an
 * absent key is what `exactOptionalPropertyTypes` lets the compiler keep honest.
 *
 * `viaNote` is omitted on the same principle but for a weaker guarantee: its CHECK is an
 * implication rather than an equality, so a `passed_on` row genuinely may hold no via
 * note — one passed on before #175 asked for one. The absent key says "there is no such
 * note", which is true in every one of the three cases that produce it.
 */
export function toIntroRequest(row: IntroRequestRow): IntroRequest {
  return {
    id: row.id,
    requesterId: row.requester_id,
    viaId: row.via_id,
    targetId: row.target_id,
    note: row.note,
    ...(row.via_note === null ? {} : { viaNote: row.via_note }),
    status: toIntroRequestStatus(row.status),
    createdAt: row.created_at,
    ...(row.decided_at === null ? {} : { decidedAt: row.decided_at }),
  };
}

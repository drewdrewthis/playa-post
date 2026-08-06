import type { Database, Selectable } from '@playa-post/database';

import type { Invitation } from '../domain/invitation';

/**
 * One `app.invitations` row as the generated schema describes it.
 *
 * Derived from `@playa-post/database`'s checked-in types rather than hand-written, so
 * a migration that changes the table breaks `pnpm typecheck` here instead of producing
 * wrong values at runtime.
 */
export type InvitationRow = Selectable<Database['app.invitations']>;

/**
 * Translate a database row into the domain's {@link Invitation}.
 *
 * `snake_case` columns and nullable timestamps are storage concerns and every one of
 * them stops at this function. Nothing above `persistence/` may see a row shape.
 *
 * `status` is carried across as-is rather than narrowed: the column has no check
 * constraint, so an unrecognised value is reachable, and `isOpenable` fails closed on
 * one (see `domain/invitation.ts`).
 */
export function toInvitation(row: InvitationRow): Invitation {
  return {
    id: row.id,
    inviterId: row.inviter_id,
    token: row.token,
    status: row.status,
    createdAt: row.created_at,
    acceptedById: row.accepted_by_id,
    acceptedAt: row.accepted_at,
    revokedAt: row.revoked_at,
  };
}

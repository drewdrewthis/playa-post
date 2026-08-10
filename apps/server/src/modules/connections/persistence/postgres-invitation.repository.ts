import type { DatabaseConnection } from '@playa-post/database';

import type { Invitation } from '../domain/invitation';
import { INVITATION_STATUS } from '../domain/invitation';
import type { InvitationRepository, NewInvitation } from '../domain/invitation.repository';

import { toInvitation } from './invitation.mapper';

/** Everything the repository needs, injected (addendum §12). */
export interface PostgresInvitationRepositoryDependencies {
  /** Connected as `app_rw` and nothing else (ADR-0002 §2). */
  readonly database: DatabaseConnection;
}

/**
 * `app.invitations`, behind the domain's {@link InvitationRepository} port.
 *
 * Every statement is schema-qualified (`app.invitations`, never `invitations`) per
 * ADR-0002's pooler-safety rules: with `search_path` outside this file's control, an
 * unqualified name is a silent cross-schema read waiting for a `public.invitations` to
 * exist.
 */
export function createPostgresInvitationRepository(
  dependencies: PostgresInvitationRepositoryDependencies,
): InvitationRepository {
  const { database } = dependencies;

  return {
    async findByToken(token: string): Promise<Invitation | null> {
      // Looked up by the token itself, which is the unique key. There is deliberately
      // no "find by inviter" and no listing: the token is shown once, at creation, and
      // an endpoint that could enumerate an account's outstanding invites would turn
      // one stolen session into every connection that account could ever have made.
      const row = await database
        .selectFrom('app.invitations')
        .selectAll()
        .where('token', '=', token)
        .executeTakeFirst();

      return row === undefined ? null : toInvitation(row);
    },

    async findLatestPendingByInviter(inviterId: string): Promise<Invitation | null> {
      // At most one row, the inviter's own, pending only — the port's doc comment is
      // the argument for why this stays on the right side of the no-listing rule.
      // `created_at desc` because "the current invite" means the newest one: rows
      // minted before get-or-create existed may leave several pending, and the newest
      // is the one the You screen most recently displayed.
      //
      // `id desc` tiebreaks it: `created_at` comes from a ms-precision clock, so two
      // racing creates can tie, and without a stable tiebreaker "newest wins" is
      // nondeterministic — successive reads could flip between tokens (same bug class
      // as the outbox `available_at` precision fix, commit 6100377).
      const row = await database
        .selectFrom('app.invitations')
        .selectAll()
        .where('inviter_id', '=', inviterId)
        .where('status', '=', INVITATION_STATUS.pending)
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .limit(1)
        .executeTakeFirst();

      return row === undefined ? null : toInvitation(row);
    },

    async add(invitation: NewInvitation): Promise<Invitation> {
      return toInvitation(
        await database
          .insertInto('app.invitations')
          .values({
            inviter_id: invitation.inviterId,
            token: invitation.token,
            created_at: invitation.createdAt,
          })
          .returningAll()
          .executeTakeFirstOrThrow(),
      );
    },
  };
}

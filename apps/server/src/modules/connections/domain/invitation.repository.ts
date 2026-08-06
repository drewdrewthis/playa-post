import type { Invitation } from './invitation';

/**
 * Everything needed to create one `app.invitations` row.
 *
 * `createdAt` is supplied rather than defaulted because the column has no default —
 * the writer states when the invite was minted, the same discipline `app.users` uses.
 */
export interface NewInvitation {
  readonly inviterId: string;
  /** From `generateInviteToken`. Opaque, and never derived from `inviterId`. */
  readonly token: string;
  readonly createdAt: Date;
}

/**
 * The invitations port.
 *
 * Declared here in `domain/` and implemented in `persistence/` (addendum §2). The
 * application layer depends on this interface and cannot see Kysely, `pg`, or SQL.
 *
 * ⚠ It has no `markAccepted`, and that absence is deliberate. Spending an invite,
 * creating the connection, and appending `ConnectionAccepted` to the outbox are **one
 * transaction** (addendum §10) — splitting them across two ports would make the
 * atomicity a convention rather than a guarantee, so the whole write lives on
 * {@link import('./connection.repository').ConnectionRepository.acceptInvitation}.
 */
export interface InvitationRepository {
  /**
   * The invite a token names, whatever state it is in.
   *
   * Returns `null` for a token that does not exist. Callers must answer "no such
   * token" and "spent token" identically — see
   * {@link import('./invitation.errors').InvitationUnavailableError}.
   */
  findByToken(token: string): Promise<Invitation | null>;

  /** Write a new invite and return the stored row. */
  add(invitation: NewInvitation): Promise<Invitation>;
}

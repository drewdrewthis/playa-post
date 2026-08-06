import type { Connection } from '../domain/connection';
import type { ConnectionAccepted } from '../domain/connection.events';
import type { ConnectionRepository } from '../domain/connection.repository';
import { isOpenable, wasAcceptedBy } from '../domain/invitation';
import { CannotAcceptOwnInviteError, InvitationUnavailableError } from '../domain/invitation.errors';
import type { InvitationRepository } from '../domain/invitation.repository';

/**
 * What acceptance is given.
 *
 * `actorId` comes from the `Actor` resolved at the tRPC context boundary, never from
 * the request body (ADR-0002:180-181). `token` is the only thing the caller supplies,
 * and holding it is the whole of their claim.
 */
export interface AcceptInviteCommand {
  readonly actorId: string;
  readonly token: string;
}

/** What acceptance produced. */
export interface AcceptInviteResult {
  readonly connection: Connection;
  /**
   * The emitted event, or `null` when this call changed nothing — a replay by the
   * same actor, or a pair that was already connected. Idempotency means the second
   * call returns the same connection, **not** that it emits a second event.
   */
  readonly event: ConnectionAccepted | null;
}

export interface AcceptInviteService {
  accept(command: AcceptInviteCommand): Promise<AcceptInviteResult>;
}

/** Collaborators, injected rather than resolved (addendum §12, ADR-0003). */
export interface AcceptInviteDependencies {
  readonly invitations: InvitationRepository;
  readonly connections: ConnectionRepository;
  /** Reads the wall clock. Overridable so a test can pin `created_at`. */
  readonly now?: (() => Date) | undefined;
}

/**
 * The accept-invite use case (M2.5) — the one write that creates a connection.
 *
 * **Rule order is the contract, not an implementation detail.**
 *
 * 1. *Unknown token* → `INVITATION_UNAVAILABLE`, worded identically to a spent one.
 *    This is also M2-AC19's IDOR case for this mutation: the input is a bearer token
 *    rather than an ID a caller could assert ownership over, so "an actor with no
 *    relationship to the subject" is precisely an actor submitting a token they do not
 *    hold — and they get a structured failure with zero rows written anywhere.
 * 2. *Replay by the same actor* → the existing connection, no second event. Checked
 *    **before** the spent-token rule, because a spent token is exactly what a replay
 *    presents; the difference is who spent it, which is why `accepted_by_id` exists.
 * 3. *Own invite* → `CANNOT_ACCEPT_OWN_INVITE`. Named rather than generic: the caller
 *    minted this token, so the reason discloses nothing they did not already know.
 * 4. *Anything not `pending`* → `INVITATION_UNAVAILABLE`.
 * 5. The write, which is one transaction across three tables — see
 *    {@link ConnectionRepository.acceptInvitation}. It re-checks `pending` under the
 *    row lock, because steps 1-4 and step 5 are separated by a window in which the
 *    inviter can revoke.
 */
export function createAcceptInviteService(
  dependencies: AcceptInviteDependencies,
): AcceptInviteService {
  const readClock = dependencies.now ?? ((): Date => new Date());

  return {
    async accept(command: AcceptInviteCommand): Promise<AcceptInviteResult> {
      const invitation = await dependencies.invitations.findByToken(command.token);

      if (invitation === null) {
        throw new InvitationUnavailableError();
      }

      if (wasAcceptedBy(invitation, command.actorId)) {
        const existing = await dependencies.connections.findBetween(
          invitation.inviterId,
          command.actorId,
        );

        // The invite says this actor spent it and yet there is no connection: the two
        // facts are written in one transaction, so this state is unreachable unless
        // something outside the application edited a row. Fail closed rather than
        // quietly re-creating the connection from an inconsistent premise.
        if (existing === null) {
          throw new InvitationUnavailableError();
        }

        return { connection: existing, event: null };
      }

      if (invitation.inviterId === command.actorId) {
        throw new CannotAcceptOwnInviteError();
      }

      if (!isOpenable(invitation)) {
        throw new InvitationUnavailableError();
      }

      return dependencies.connections.acceptInvitation({
        invitation,
        inviteeId: command.actorId,
        occurredAt: readClock(),
      });
    },
  };
}

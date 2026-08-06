import { isOpenable } from '../domain/invitation';
import { InvitationUnavailableError } from '../domain/invitation.errors';
import type { InvitationRepository } from '../domain/invitation.repository';

/** What opening an invite is given: the token, and nothing else. */
export interface OpenInviteCommand {
  readonly token: string;
}

/**
 * What the holder of a live token learns.
 *
 * **An identifier, not a person.** ADR-0002 §6a requires every representation of a
 * person to be projected through `app.visible_people`'s disclosure level, and the
 * opener is by definition not yet connected to the inviter — so there is no
 * disclosure level under which a name could be returned here. The client renders
 * "someone invited you"; the name arrives with the connection.
 */
export interface OpenedInvite {
  readonly inviterId: string;
}

export interface OpenInviteService {
  open(command: OpenInviteCommand): Promise<OpenedInvite>;
}

/** Collaborators, injected rather than resolved (addendum §12, ADR-0003). */
export interface OpenInviteDependencies {
  readonly invitations: InvitationRepository;
}

/**
 * The open-invite use case (M2.5): what does this token get me?
 *
 * A read, and the only place a token is exchanged for anything before acceptance. It
 * is also the surface an attacker would grind against, which is why **every refusal is
 * the same refusal**: no such token, spent token, and revoked token all answer
 * `INVITATION_UNAVAILABLE` with one message. Distinguishing them would turn this into
 * an oracle for whether a guessed string was ever a real invite.
 */
export function createOpenInviteService(dependencies: OpenInviteDependencies): OpenInviteService {
  return {
    async open(command: OpenInviteCommand): Promise<OpenedInvite> {
      const invitation = await dependencies.invitations.findByToken(command.token);

      if (invitation === null || !isOpenable(invitation)) {
        throw new InvitationUnavailableError();
      }

      return { inviterId: invitation.inviterId };
    },
  };
}

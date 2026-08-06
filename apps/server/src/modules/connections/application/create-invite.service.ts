import type { InvitationRepository } from '../domain/invitation.repository';
import { generateInviteToken } from '../domain/invite-token';

/**
 * What creating an invite is given.
 *
 * `inviterId` comes from the `Actor` resolved at the tRPC context boundary and is
 * **never** a field on a procedure input (ADR-0002:180-181). Nothing a caller sends
 * can set it.
 */
export interface CreateInviteCommand {
  readonly inviterId: string;
}

/** The minted invite. */
export interface CreatedInvite {
  /** The whole product: an opaque bearer token to share out of band. */
  readonly token: string;
  readonly invitationId: string;
  readonly createdAt: Date;
}

export interface CreateInviteService {
  create(command: CreateInviteCommand): Promise<CreatedInvite>;
}

/** Collaborators, injected rather than resolved (addendum §12, ADR-0003). */
export interface CreateInviteDependencies {
  readonly invitations: InvitationRepository;
  /** Reads the wall clock. Overridable so a test can pin `created_at`. */
  readonly now?: (() => Date) | undefined;
}

/**
 * The create-invite use case (M2.5).
 *
 * Deliberately thin, and deliberately without a per-inviter cap or a reuse check. An
 * invite token is a bearer credential with no relationship to its holder, so "one live
 * invite per person" would be a constraint the product does not have: people hand out
 * different links to different people, and revocation — M5 — is what takes one back.
 *
 * There is no way to *list* somebody's invites either. The token is shown once, at
 * creation; a listing endpoint would turn a leaked session into every outstanding
 * invite that account ever minted.
 */
export function createCreateInviteService(
  dependencies: CreateInviteDependencies,
): CreateInviteService {
  const readClock = dependencies.now ?? ((): Date => new Date());

  return {
    async create(command: CreateInviteCommand): Promise<CreatedInvite> {
      const invitation = await dependencies.invitations.add({
        inviterId: command.inviterId,
        // The subject is handed to the generator and ignored by it, on purpose — see
        // `domain/invite-token.ts`. Passing it is what makes M2-AC17's "the token is
        // not an encoding of the inviter" assertable against the real call site.
        token: generateInviteToken({ id: command.inviterId }),
        createdAt: readClock(),
      });

      return {
        token: invitation.token,
        invitationId: invitation.id,
        createdAt: invitation.createdAt,
      };
    },
  };
}

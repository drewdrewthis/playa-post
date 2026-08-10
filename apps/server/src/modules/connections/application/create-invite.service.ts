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
 * The create-invite use case (M2.5), get-or-create since PR #144.
 *
 * `create` returns the caller's newest still-pending invite and mints only when none
 * is outstanding. That is not a per-inviter cap — nothing stops a new invite once the
 * current one is spent or (M5) revoked — it is a refusal to mint a second token while
 * the first was never used. The You screen's standing CONNECT card made `create` fire
 * on page arrival rather than on a click, and every arrival minting a fresh uncapped
 * bearer credential was an amplification lever plus a stale-card bug (the client cache
 * forgetting is what used to decide when a new row appeared). Idempotence here retires
 * both. Two truly concurrent first calls can still race into two rows; both are valid,
 * the newer wins on the next read, and that is the pre-#144 behavior at worst.
 *
 * There is still no way to *list* somebody's invites. The token is shown at creation
 * and re-shown only to its own pending inviter — a listing endpoint would turn a
 * leaked session into every outstanding invite that account ever minted.
 */
export function createCreateInviteService(
  dependencies: CreateInviteDependencies,
): CreateInviteService {
  const readClock = dependencies.now ?? ((): Date => new Date());

  return {
    async create(command: CreateInviteCommand): Promise<CreatedInvite> {
      const outstanding = await dependencies.invitations.findLatestPendingByInviter(
        command.inviterId,
      );
      if (outstanding !== null) {
        return {
          token: outstanding.token,
          invitationId: outstanding.id,
          createdAt: outstanding.createdAt,
        };
      }

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

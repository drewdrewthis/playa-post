import type { PersonalLink } from '../domain/personal-link';
import { generatePersonalLinkSlug } from '../domain/personal-link';
import type { PersonalLinkRepository } from '../domain/personal-link.repository';

/**
 * What ensuring a link is given: the owner, and nothing else.
 *
 * `ownerId` comes from the `Actor` resolved at the tRPC context boundary and is **never** a
 * field on a procedure input (ADR-0002:180-181, B14). There is exactly one link a caller may
 * ensure, so there is no parameter that could name a different one.
 */
export interface EnsurePersonalLinkCommand {
  readonly ownerId: string;
}

export interface EnsurePersonalLinkService {
  ensure(command: EnsurePersonalLinkCommand): Promise<PersonalLink>;
}

/** Collaborators, injected rather than resolved (addendum §12, ADR-0003). */
export interface EnsurePersonalLinkDependencies {
  readonly personalLinks: PersonalLinkRepository;
  /** Reads the wall clock. Overridable so a test can pin `created_at`. */
  readonly now?: (() => Date) | undefined;
}

/**
 * The ensure-my-link use case (issue #206).
 *
 * **Get-or-create, and a mutation rather than a query for exactly that reason.** Every user
 * has a personal link the moment they look for one; nobody has one before that. The
 * alternative — minting at onboarding — would leave every account that already exists
 * without a link and would need a backfill plus a cross-module write, so the link is minted
 * lazily on first sight instead. That is a write, so it is a mutation, and calling it a
 * query because the caller's *intent* is to read would be a side-effecting GET.
 *
 * It is the same shape `create-invite.service.ts` settled on and for the same reason a
 * standing card on the You screen demands it: the screen calls this on arrival, so calling
 * it twice must not produce two of anything. Here the idempotence is stronger than the
 * invite's — the row is keyed by `owner_id`, so it is enforced by the database rather than
 * by a read-then-write that two concurrent calls could both lose.
 *
 * ⚠ **A slug is generated on every call and discarded on all but the first.** That is what
 * keeps the repository's statement single: a get-then-maybe-mint would be a read the write
 * could race, and the losing half of that race is somebody's published address changing
 * under them. Drawing 16 unused CSPRNG bytes is cheaper than the read it replaces.
 */
export function createEnsurePersonalLinkService(
  dependencies: EnsurePersonalLinkDependencies,
): EnsurePersonalLinkService {
  const readClock = dependencies.now ?? ((): Date => new Date());

  return {
    async ensure(command: EnsurePersonalLinkCommand): Promise<PersonalLink> {
      return dependencies.personalLinks.ensureFor({
        ownerId: command.ownerId,
        // The owner is handed to the generator and ignored by it, on purpose — see
        // `domain/personal-link.ts`. Passing it is what makes "the slug is not an encoding
        // of its owner" assertable against the real call site.
        slug: generatePersonalLinkSlug({ id: command.ownerId }),
        at: readClock(),
      });
    },
  };
}

import type { PersonalLink } from '../domain/personal-link';
import { generatePersonalLinkSlug } from '../domain/personal-link';
import type { PersonalLinkRepository } from '../domain/personal-link.repository';

/**
 * What rotating is given: the owner, and nothing else.
 *
 * `ownerId` comes from the `Actor` resolved at the tRPC context boundary and is **never** a
 * field on a procedure input (ADR-0002:180-181, B14). There is exactly one link a caller may
 * rotate — their own — so there is no parameter that could name somebody else's, and no
 * `slug` field either: rotating by naming the *current* slug would let anybody who held the
 * URL retire it.
 */
export interface RotatePersonalLinkCommand {
  readonly ownerId: string;
}

export interface RotatePersonalLinkService {
  rotate(command: RotatePersonalLinkCommand): Promise<PersonalLink>;
}

/** Collaborators, injected rather than resolved (addendum §12, ADR-0003). */
export interface RotatePersonalLinkDependencies {
  readonly personalLinks: PersonalLinkRepository;
  /** Reads the wall clock. Overridable so a test can pin `rotated_at`. */
  readonly now?: (() => Date) | undefined;
}

/**
 * The rotate-my-link use case (issue #206).
 *
 * One step and no second: mint a fresh slug and hand one atomic upsert to the repository.
 *
 * ⚠ **There is deliberately no confirmation, no cool-down, and no rate limit on rotating.**
 * The product statement is one tap, guilt-free — an owner who is being bothered through
 * their link should not have to argue with a dialog to stop it, and a cool-down would mean
 * the one moment somebody most wants to rotate is the moment they cannot. The cost of an
 * accidental rotation is that already-shared URLs stop resolving, which is recoverable by
 * re-sharing; the cost of a slow rotation is not.
 *
 * ⚠ **Rotation touches no connection and no received request.** Nothing here reads or
 * writes either table, and the repository's statement names only `app.personal_links`, so
 * the guarantee is structural rather than a promise this file makes.
 */
export function createRotatePersonalLinkService(
  dependencies: RotatePersonalLinkDependencies,
): RotatePersonalLinkService {
  const readClock = dependencies.now ?? ((): Date => new Date());

  return {
    async rotate(command: RotatePersonalLinkCommand): Promise<PersonalLink> {
      return dependencies.personalLinks.rotateFor({
        ownerId: command.ownerId,
        // A fresh CSPRNG draw, never derived from the slug being replaced: somebody
        // holding the old URL must not be able to recognise the new one, or rotating
        // announces itself to exactly the person it exists to shed.
        slug: generatePersonalLinkSlug({ id: command.ownerId }),
        at: readClock(),
      });
    },
  };
}

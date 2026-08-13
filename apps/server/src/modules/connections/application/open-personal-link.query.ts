import { liveRequestFloor } from '../domain/connection-request.policy';
import { PersonalLinkUnavailableError } from '../domain/personal-link.errors';

import { toOpenedPersonalLink, type OpenedPersonalLink } from './opened-personal-link';
import type { VisibleConnectionRequestsRepository } from './visible-connection-requests.repository';

/**
 * What opening a link is given.
 *
 * `viewerId` comes from the `Actor` resolved at the tRPC context boundary and is **never** a
 * field on a procedure input (ADR-0002:180-181, B14). `slug` is the only thing the caller
 * supplies, and holding it is the whole of their claim to see who it belongs to.
 */
export interface OpenPersonalLinkCommand {
  readonly viewerId: string;
  readonly slug: string;
}

export interface OpenPersonalLinkQuery {
  open(command: OpenPersonalLinkCommand): Promise<OpenedPersonalLink>;
}

/** Collaborators, injected rather than resolved (addendum §12, ADR-0003). */
export interface OpenPersonalLinkDependencies {
  readonly links: VisibleConnectionRequestsRepository;
  /** Reads the wall clock, for the TTL floor. Overridable so a test can pin the boundary. */
  readonly now?: (() => Date) | undefined;
}

/**
 * The open-a-personal-link use case (issue #206) — who does this address belong to?
 *
 * A read, and the only place a slug is exchanged for anything. **Opening connects nobody**:
 * that is the whole difference from `open-invite.service.ts`'s neighbour
 * `accept-invite.service.ts`, where the equivalent read was one tap away from a connection
 * the owner never agreed to.
 *
 * It is also the surface an attacker would grind against, which is why **every refusal is
 * the same refusal**: no such slug, a rotated slug, and a deactivated owner all answer
 * `PERSONAL_LINK_UNAVAILABLE` with one message. Distinguishing them would turn this into an
 * oracle for whether a guessed string was ever a real link — and, worse, would tell whoever
 * kept an old URL that its owner had deliberately shed it.
 *
 * ⚠ **Unlike `open-invite.service.ts`, this read names a person**, and that is not a
 * loosening of ADR-0002 §6a but an instance of ADR-0017 D4's consent inversion: the owner
 * published this address, so being named to whoever holds it is the act they performed. The
 * card still comes out of `app.visible_people` — the owner's own self-projection — so a
 * deactivated owner has no card and therefore no link, with no extra check here to forget.
 */
export function createOpenPersonalLinkQuery(
  dependencies: OpenPersonalLinkDependencies,
): OpenPersonalLinkQuery {
  const readClock = dependencies.now ?? ((): Date => new Date());

  return {
    async open(command: OpenPersonalLinkCommand): Promise<OpenedPersonalLink> {
      const facts = await dependencies.links.findLinkBySlugFor(
        command.viewerId,
        command.slug,
        liveRequestFloor(readClock()),
      );

      if (facts === null) {
        throw new PersonalLinkUnavailableError();
      }

      return toOpenedPersonalLink(facts, command.viewerId);
    },
  };
}

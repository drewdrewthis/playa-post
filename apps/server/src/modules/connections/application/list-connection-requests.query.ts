import { liveRequestFloor } from '../domain/connection-request.policy';

import type { VisibleConnectionRequest } from './visible-connection-request';
import type { VisibleConnectionRequestsRepository } from './visible-connection-requests.repository';

/**
 * What reading the request inbox is given. Nothing but the resolved viewer.
 *
 * ⚠ `viewerId` is the reading actor's `app.users.id`, and it must arrive from the `Actor`
 * resolved at the tRPC context boundary — never from request input (ADR-0002 §5a, B14).
 *
 * There is no filter, no status selector, and no other person's ID — so there is nothing
 * here a caller could aim at somebody else's inbox even if a field appeared.
 */
export interface ListConnectionRequestsCommand {
  readonly viewerId: string;
}

export interface ListConnectionRequestsQuery {
  list(command: ListConnectionRequestsCommand): Promise<readonly VisibleConnectionRequest[]>;
}

/** Collaborators, injected rather than resolved (addendum §12, ADR-0003). */
export interface ListConnectionRequestsDependencies {
  readonly requests: VisibleConnectionRequestsRepository;
  /** Reads the wall clock, for the TTL floor. Overridable so a test can pin the boundary. */
  readonly now?: (() => Date) | undefined;
}

/**
 * The owner's connection-request inbox (issue #206).
 *
 * One step, and the thinness is the design: which rows a viewer may read is one statement in
 * `persistence/`, so there is nothing for this layer to add.
 *
 * ⚠ **The TTL floor is computed here and passed down, rather than written into the SQL.**
 * The same floor is passed to the decide path, so "what the owner can see" and "what the
 * owner can answer" are the same arithmetic from the same constant — a lapsed request that
 * was still listed would render a button the server refuses, which is the worst possible
 * place for two spellings of one rule to drift.
 *
 * ⚠ **Do not add a status filter parameter.** `pending` is not a default here, it is the
 * authorization: a parameter that narrowed it would be harmless and a parameter that
 * widened it would serve rows — declined ones especially — that no reader may have.
 */
export function createListConnectionRequestsQuery(
  dependencies: ListConnectionRequestsDependencies,
): ListConnectionRequestsQuery {
  const readClock = dependencies.now ?? ((): Date => new Date());

  return {
    async list(
      command: ListConnectionRequestsCommand,
    ): Promise<readonly VisibleConnectionRequest[]> {
      return dependencies.requests.findInboxFor(
        command.viewerId,
        liveRequestFloor(readClock()),
      );
    },
  };
}

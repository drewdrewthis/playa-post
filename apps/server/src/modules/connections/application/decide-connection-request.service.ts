import type { ConnectionRequest, ConnectionRequestDecision } from '../domain/connection-request';
import { liveRequestFloor } from '../domain/connection-request.policy';
import type { ConnectionRequestRepository } from '../domain/connection-request.repository';

/**
 * What deciding a request is given.
 *
 * `actorId` comes from the `Actor` resolved at the tRPC context boundary and is **never** a
 * field on a procedure input (ADR-0002:180-181, B14). It is compared against the row's
 * stored `owner_id` inside the update, so "only the owner may decide" is a predicate on the
 * statement rather than a check anybody could reorder.
 */
export interface DecideConnectionRequestCommand {
  readonly connectionRequestId: string;
  readonly actorId: string;
  readonly decision: ConnectionRequestDecision;
}

export interface DecideConnectionRequestService {
  decide(command: DecideConnectionRequestCommand): Promise<ConnectionRequest>;
}

/** Collaborators, injected rather than resolved (addendum §12, ADR-0003). */
export interface DecideConnectionRequestDependencies {
  readonly connectionRequests: ConnectionRequestRepository;
  /** Reads the wall clock. Overridable so a test can pin `decided_at` and the TTL floor. */
  readonly now?: (() => Date) | undefined;
}

/**
 * The decide-a-connection-request use case (issue #206) — the owner as the gate.
 *
 * One step and no second: read the clock once, then hand one atomic write to the
 * repository. Every rule about who may decide, what state the row must be in, and whether
 * it has lapsed lives inside that single gated UPDATE. A check here would be a read the
 * update could then race, and the losing half of that race creates a connection out of
 * consent that had already been withdrawn or had already expired.
 *
 * ⚠ **This service does not branch on the decision, and must not start.** The two decisions
 * differ in exactly one place — whether the same transaction also writes `app.connections`
 * — and that difference is expressed inside the statement that enforces it. An `if` here
 * would be a second copy of the distinction in the one layer that can enforce neither half.
 *
 * ⚠ **One clock reading, used for both `decided_at` and the TTL floor**, so a request
 * decided on the boundary is judged against the same instant it is stamped with.
 */
export function createDecideConnectionRequestService(
  dependencies: DecideConnectionRequestDependencies,
): DecideConnectionRequestService {
  const readClock = dependencies.now ?? ((): Date => new Date());

  return {
    async decide(command: DecideConnectionRequestCommand): Promise<ConnectionRequest> {
      const decidedAt = readClock();

      return dependencies.connectionRequests.decide({
        connectionRequestId: command.connectionRequestId,
        actorId: command.actorId,
        decision: command.decision,
        decidedAt,
        liveSince: liveRequestFloor(decidedAt),
      });
    },
  };
}

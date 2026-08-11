import type { IntroRequest, IntroResponse } from '../domain/intro-request';
import type { IntroRequestRepository } from '../domain/intro-request.repository';

/**
 * What answering an introduction is given (issue #166).
 *
 * `actorId` comes from the `Actor` resolved at the tRPC context boundary and is **never**
 * a field on a procedure input (ADR-0002:180-181, B14). It is compared against the row's
 * stored `target_id` inside the update, so "only the target may answer" is a predicate on
 * the statement rather than a check anybody could reorder.
 */
export interface RespondToIntroCommand {
  readonly introRequestId: string;
  readonly actorId: string;
  readonly response: IntroResponse;
}

export interface RespondToIntroService {
  respond(command: RespondToIntroCommand): Promise<IntroRequest>;
}

/** Collaborators, injected rather than resolved (addendum §12, ADR-0003). */
export interface RespondToIntroDependencies {
  readonly introRequests: IntroRequestRepository;
  /** Reads the wall clock. Overridable so a test can pin `responded_at`. */
  readonly now?: (() => Date) | undefined;
}

/**
 * The answer-an-introduction use case (issue #166) — the target's end of the one hop.
 *
 * One step and no second: hand one atomic write to the repository. Every rule about who
 * may answer, what state the row must be in, and how many times it may happen lives
 * inside the repository's single gated UPDATE
 * ({@link IntroRequestRepository.respond}). A check here would be a read the update could
 * then race, and the losing half of that race is a duplicate connection rather than a
 * stale screen.
 *
 * ⚠ **There is nothing to validate, and the absence is the design.** Neither answer
 * carries content: an acceptance says nothing beyond itself, and a decline says less —
 * the requester is never told it happened, so text written on one would have no reader at
 * all. That is the same rule `validateViaNote` enforces for a via's decline, one person
 * along, and here it is expressed by the wire schema having no field rather than by a
 * policy refusing one.
 *
 * ⚠ **This service does not create the connection, and must not start.** An acceptance
 * emits `IntroAccepted` inside the same transaction as the status, and
 * `modules/connections` writes the edge from that event (decision D12, ADR-0006). Calling
 * a connections service from here would put the two facts in two transactions, where a
 * failure between them leaves an introduction that says `accepted` with no connection and
 * — because answering is terminal-once — no way for anybody to retry it.
 */
export function createRespondToIntroService(
  dependencies: RespondToIntroDependencies,
): RespondToIntroService {
  const readClock = dependencies.now ?? ((): Date => new Date());

  return {
    async respond(command: RespondToIntroCommand): Promise<IntroRequest> {
      return dependencies.introRequests.respond({
        introRequestId: command.introRequestId,
        actorId: command.actorId,
        response: command.response,
        respondedAt: readClock(),
      });
    },
  };
}

import { validateIntroNote } from '../domain/intro-note.policy';
import type { IntroRequest } from '../domain/intro-request';
import type { IntroRequestRepository } from '../domain/intro-request.repository';

/**
 * What requesting an intro is given.
 *
 * `requesterId` comes from the `Actor` resolved at the tRPC context boundary and is
 * **never** a field on a procedure input (ADR-0002:180-181, B14). `viaId` and `targetId`
 * name the *other* two parties — claims the server then has to authorize, which is what
 * the repository's gated insert does.
 */
export interface RequestIntroCommand {
  readonly requesterId: string;
  /** Who to ask. Must be a shared first-degree connection of requester and target. */
  readonly viaId: string;
  /** Who to meet. Must stand at exactly degree 2 from the requester. */
  readonly targetId: string;
  readonly note: string;
}

export interface RequestIntroService {
  request(command: RequestIntroCommand): Promise<IntroRequest>;
}

/** Collaborators, injected rather than resolved (addendum §12, ADR-0003). */
export interface RequestIntroDependencies {
  readonly introRequests: IntroRequestRepository;
  /** Reads the wall clock. Overridable so a test can pin `created_at`. */
  readonly now?: (() => Date) | undefined;
}

/**
 * The request-an-intro use case (issue #89).
 *
 * Two steps and no third: validate the note, then hand one atomic write to the
 * repository.
 *
 * ⚠ **The order of those two steps is a privacy rule.** Content is checked *before*
 * eligibility, so an invalid note aimed at an unreachable target answers
 * `INTRO_CONTENT_INVALID` rather than `INTRO_UNAVAILABLE`. Reversed, a caller could probe
 * reachability by sending deliberate rubbish and reading which refusal came back — the
 * oracle `IntroUnavailableError` exists to close, reopened by an ordering nobody would
 * think to look at.
 *
 * ⚠ **Authorization is deliberately absent from this file.** "Is this via a candidate"
 * and "is there already an open ask for this pair" are decided by the `WHERE EXISTS` and
 * the `ON CONFLICT` inside the repository's insert, not by checks here, because a check
 * here would be a read that the write could then race. This service must never grow a
 * copy of either: two places deciding who may be introduced is two answers, and the
 * cheaper one always wins the race.
 *
 * There is deliberately no `mutationId` idempotency and no rate limit. Replay
 * idempotency is the sync envelope's job (ADR-0005) — and `intros.request` is not
 * offline-queueable anyway, because eligibility is time-varying and a queued ask could
 * drain into a graph where it is no longer true.
 */
export function createRequestIntroService(
  dependencies: RequestIntroDependencies,
): RequestIntroService {
  const readClock = dependencies.now ?? ((): Date => new Date());

  return {
    async request(command: RequestIntroCommand): Promise<IntroRequest> {
      const note = validateIntroNote(command.note);
      // One clock reading, taken after validation so a refused request never advances it.
      const createdAt = readClock();

      return dependencies.introRequests.request({
        requesterId: command.requesterId,
        viaId: command.viaId,
        targetId: command.targetId,
        note,
        createdAt,
      });
    },
  };
}

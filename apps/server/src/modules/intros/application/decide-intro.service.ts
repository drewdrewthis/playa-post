import type { IntroDecision, IntroRequest } from '../domain/intro-request';
import type { IntroRequestRepository } from '../domain/intro-request.repository';

/**
 * What deciding an intro request is given.
 *
 * `actorId` comes from the `Actor` resolved at the tRPC context boundary and is **never**
 * a field on a procedure input (ADR-0002:180-181, B14). It is compared against the row's
 * stored `via_id` inside the update, so "only the named via may decide" is a predicate on
 * the statement rather than a check anybody could reorder.
 */
export interface DecideIntroCommand {
  readonly introRequestId: string;
  readonly actorId: string;
  readonly decision: IntroDecision;
}

export interface DecideIntroService {
  decide(command: DecideIntroCommand): Promise<IntroRequest>;
}

/** Collaborators, injected rather than resolved (addendum §12, ADR-0003). */
export interface DecideIntroDependencies {
  readonly introRequests: IntroRequestRepository;
  /** Reads the wall clock. Overridable so a test can pin `decided_at`. */
  readonly now?: (() => Date) | undefined;
}

/**
 * The decide-an-intro use case (issue #89).
 *
 * One step, and the thinness is the design: every rule about who may decide, what state
 * the row must be in, and — for `pass_on` — whether the introduction is still one the
 * graph permits, lives inside the repository's single gated UPDATE. A check here would be
 * a read the update could then race, and the losing half of that race is a disclosure
 * rather than a stale screen.
 *
 * ⚠ **This service does not branch on the decision, and must not start.** `pass_on` and
 * `decline` differ by exactly one clause in one statement — the eligibility re-check —
 * and expressing that difference here would put half of an authorization rule in a layer
 * that cannot enforce the other half.
 */
export function createDecideIntroService(
  dependencies: DecideIntroDependencies,
): DecideIntroService {
  const readClock = dependencies.now ?? ((): Date => new Date());

  return {
    async decide(command: DecideIntroCommand): Promise<IntroRequest> {
      return dependencies.introRequests.decide({
        introRequestId: command.introRequestId,
        actorId: command.actorId,
        decision: command.decision,
        decidedAt: readClock(),
      });
    },
  };
}

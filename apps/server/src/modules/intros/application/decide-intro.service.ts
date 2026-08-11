import { validateViaNote } from '../domain/intro-note.policy';
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
  /**
   * What the via wants to say about the introduction, **as submitted** — untrimmed,
   * unbounded, and absent when they sent none (issue #175).
   *
   * Optional here and required by the domain for a `pass_on`, which is not a
   * contradiction: "a caller may omit this field" and "omitting it is refused" are
   * different statements, and only {@link import('../domain/intro-note.policy').validateViaNote}
   * gets to make the second one.
   */
  readonly viaNote?: string;
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
 * Two steps and no third: validate the via's own note, then hand one atomic write to the
 * repository. Every rule about who may decide, what state the row must be in, and — for
 * `pass_on` — whether the introduction is still one the graph permits, lives inside the
 * repository's single gated UPDATE. A check here would be a read the update could then
 * race, and the losing half of that race is a disclosure rather than a stale screen.
 *
 * ⚠ **The note is validated before the row is looked for**, matching
 * `request-intro.service.ts` and for the same reason: a content refusal that arrived only
 * for requests that turned out to exist would answer "yes, that id names a real intro
 * addressed to you" to anybody willing to send deliberate rubbish twice.
 *
 * ⚠ **This service does not branch on the decision, and must not start.** The two
 * decisions differ in two places — the eligibility re-check, which is one clause of one
 * SQL statement, and whether a note is required, which is
 * {@link import('../domain/intro-note.policy').validateViaNote} — and both differences
 * are expressed where the rule they belong to is enforced. An `if` here would be a third
 * copy of the distinction, in the one layer that can enforce neither half.
 */
export function createDecideIntroService(
  dependencies: DecideIntroDependencies,
): DecideIntroService {
  const readClock = dependencies.now ?? ((): Date => new Date());

  return {
    async decide(command: DecideIntroCommand): Promise<IntroRequest> {
      const viaNote = validateViaNote(command.decision, command.viaNote);

      return dependencies.introRequests.decide({
        introRequestId: command.introRequestId,
        actorId: command.actorId,
        decision: command.decision,
        // Omitted rather than passed as `undefined`, and `exactOptionalPropertyTypes` is
        // what keeps that honest: the port's field means "there is a note", so an absent
        // key is the only way to say there is not one — and it is what makes the column
        // beneath it null, which the table's CHECK then has something to check.
        ...(viaNote === undefined ? {} : { viaNote }),
        decidedAt: readClock(),
      });
    },
  };
}

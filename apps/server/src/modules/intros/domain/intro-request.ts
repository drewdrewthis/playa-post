/**
 * The five states an intro request can be in.
 *
 * ```
 * requested ──pass_on──▶ passed_on ──accept───▶ accepted         (terminal)
 *      │                     └──────decline───▶ target_declined  (terminal)
 *      └─────decline───▶ declined                                (terminal)
 * ```
 *
 * A `text` column with a CHECK rather than an enum, matching
 * {@link import('../../connections/domain/connection').CONNECTION_STATUS}: adding a
 * state is a migration rather than a type rewrite, which is exactly what issue #166 did
 * to the three #89 shipped.
 *
 * ⚠ **Two actors, two decisions, and the second one only follows the first.** The via
 * decides whether the introduction happens at all; the target decides what to do with the
 * one they were given. They are separate columns and separate statuses rather than a
 * shared vocabulary because neither actor may make the other's choice — see
 * {@link INTRO_DECISION} and {@link INTRO_RESPONSE}.
 *
 * Exported so a consumer branching on status compares against this rather than
 * re-spelling the literal.
 */
export const INTRO_REQUEST_STATUS = {
  /** Waiting on the via. The only state the via's inbox shows. */
  requested: 'requested',
  /** The via passed it on. The only state a target may answer, and the only one they see. */
  passedOn: 'passed_on',
  /**
   * The via declined.
   *
   * ⚠ **Invisible to the target forever.** The target must never be able to tell
   * "somebody asked and was declined" from "nobody asked" — that indistinguishability is
   * the whole of what makes declining safe for the via, and it is asserted by deep
   * equality against a never-asked control user rather than by an absent-field check.
   */
  declined: 'declined',
  /**
   * The target accepted the introduction (issue #166).
   *
   * ⚠ **This is the state that makes a connection**, and it is the only one in this
   * module that changes anything outside it. The connection itself is written by
   * `modules/connections` from the `IntroAccepted` event rather than from here (decision
   * D12), so reaching this status and forming the edge are one transactional fact plus one
   * at-least-once delivery, never two writes that could disagree.
   */
  accepted: 'accepted',
  /**
   * The target declined the introduction (issue #166).
   *
   * ⚠ **`target_declined`, not a second meaning for {@link INTRO_REQUEST_STATUS.declined}.**
   * That one says the via would not pass it on and the target was never told; this one
   * says the target read it and said no. Collapsing them would make the requester's record
   * unable to tell "nobody showed them" from "they saw it and declined" — and would make
   * every read that filters on `declined` silently start matching rows a target has seen.
   *
   * ⚠ **Indistinguishable from an unanswered introduction, to the requester.** The same
   * rule that keeps a via's decline invisible to the target applies here one person along:
   * somebody who can be seen refusing cannot safely refuse. `findOutboxFor` reports the
   * via's decision and never the target's answer.
   */
  targetDeclined: 'target_declined',
} as const;

/** One of {@link INTRO_REQUEST_STATUS}'s values. */
export type IntroRequestStatus = (typeof INTRO_REQUEST_STATUS)[keyof typeof INTRO_REQUEST_STATUS];

/**
 * What the via may do with a request, and the only two things they may do.
 *
 * Separate from {@link INTRO_REQUEST_STATUS} because a decision is an *input* and a
 * status is stored state: `requested` is not a decision anybody can make, and modelling
 * them as one type would let a caller ask to un-decide.
 */
export const INTRO_DECISION = {
  passOn: 'pass_on',
  decline: 'decline',
} as const;

/** One of {@link INTRO_DECISION}'s values. */
export type IntroDecision = (typeof INTRO_DECISION)[keyof typeof INTRO_DECISION];

/** The stored status a decision produces. Total over {@link IntroDecision}. */
export const STATUS_FOR_DECISION: Readonly<Record<IntroDecision, IntroRequestStatus>> = {
  [INTRO_DECISION.passOn]: INTRO_REQUEST_STATUS.passedOn,
  [INTRO_DECISION.decline]: INTRO_REQUEST_STATUS.declined,
};

/**
 * What the **target** may do with an introduction that was passed on to them, and the
 * only two things they may do (issue #166).
 *
 * ⚠ **Its own vocabulary, not {@link INTRO_DECISION} reused**, even though both spell one
 * of their values `decline`. A decision is the via's answer to "should these two meet at
 * all"; a response is the target's answer to "do I want to meet this person". One type
 * for both would let a caller submit `pass_on` as a target — a state transition no
 * statement in this module implements — and would put the two actors' authorization rules
 * behind one union that a future `if` could cross.
 */
export const INTRO_RESPONSE = {
  accept: 'accept',
  decline: 'decline',
} as const;

/** One of {@link INTRO_RESPONSE}'s values. */
export type IntroResponse = (typeof INTRO_RESPONSE)[keyof typeof INTRO_RESPONSE];

/** The stored status a response produces. Total over {@link IntroResponse}. */
export const STATUS_FOR_RESPONSE: Readonly<Record<IntroResponse, IntroRequestStatus>> = {
  [INTRO_RESPONSE.accept]: INTRO_REQUEST_STATUS.accepted,
  [INTRO_RESPONSE.decline]: INTRO_REQUEST_STATUS.targetDeclined,
};

/**
 * The statuses a target's answer produces, as the set a reader can test membership in.
 *
 * Derived from {@link STATUS_FOR_RESPONSE} rather than written out again, so "a request
 * the target has answered" cannot drift from "a status a response produces" — the two are
 * the same claim and a third response would otherwise need remembering in two places. The
 * outbox read (`postgres-intro-request.repository.ts`) builds its mask from this set, so a
 * status a response produces can never leak to the requester merely because somebody
 * forgot to add it to a hand-written list.
 */
export const ANSWERED_STATUSES: ReadonlySet<IntroRequestStatus> = new Set(
  Object.values(STATUS_FOR_RESPONSE),
);

/**
 * An intro request as `app.intro_requests` stores one.
 *
 * This is the entity, not a read model. It carries every party's raw identifier and the
 * note body, because the only paths that reconstruct it are the two writes — requesting
 * and deciding — where the actor is one of the parties and supplied or was named in the
 * row. **Nothing projected to a client is built from this**; the three role-scoped reads
 * answer with `application/`'s read models instead, each projected through
 * `app.visible_people` and therefore through ADR-0002 §6a.
 *
 * ⚠ **Three parties, not two, and that is why this is not a note.** A note has an author
 * and a recipient and no lifecycle (`modules/notes/domain/note.ts`); this has a
 * requester, a via who decides, and a target who is told only if they do. Nullable
 * `via_id`/`status` columns on `app.notes` would have been the placeholder shape
 * addendum §4 forbids.
 *
 * There is deliberately no `version`. There is no mutation ADR-0005 marks
 * `expectedVersion: yes` here — deciding is a gated UPDATE whose `where status =
 * 'requested'` *is* the concurrency control — so a version column would be one nothing
 * reads.
 */
export interface IntroRequest {
  readonly id: string;
  /** Who asked. Taken from the resolved `Actor`, never from request input. */
  readonly requesterId: string;
  /**
   * Who was asked to make the introduction.
   *
   * A first-degree connection of the requester who is also directly connected to the
   * target, at the moment the request was written — and re-checked at the moment it is
   * passed on. The check is part of each statement rather than a prior read, so there is
   * no window in which the graph could change between a check and a write (see
   * {@link import('./intro-request.repository').IntroRequestRepository}).
   */
  readonly viaId: string;
  /** Who the requester wants to meet. Second degree at the moment of asking. */
  readonly targetId: string;
  /** Already trimmed and bounded by `intro-note.policy.ts`. */
  readonly note: string;
  /**
   * What the **via** said when they passed it on (issue #175). Already trimmed and
   * bounded by the same policy that bounds {@link IntroRequest.note}.
   *
   * ⚠ **Absent, not empty**, and three different situations produce the absence: the
   * request is still open, the via declined — a decline carries no note at all — or the
   * pass-on predates #175 requiring one. `via_note is null or status = 'passed_on'` is a
   * database CHECK, deliberately an implication rather than the equality
   * `decided_at` gets, because the third case is a row that already exists and must stay
   * valid. The requirement on every *new* pass-on lives in `intro-note.policy.ts`.
   */
  readonly viaNote?: string;
  readonly status: IntroRequestStatus;
  readonly createdAt: Date;
  /**
   * When the via decided, or `undefined` while the request is still open.
   *
   * Absent rather than `null`: `(status = 'requested') = (decided_at is null)` is a
   * database CHECK, so the two can never disagree, and an omitted key is what
   * `exactOptionalPropertyTypes` lets the compiler keep honest.
   *
   * ⚠ **Never overwritten by the target's answer.** It is the via's timestamp, and an
   * accepted introduction still has to say when the introduction itself was made.
   */
  readonly decidedAt?: Date;
  /**
   * When the target answered, or `undefined` until they do (issue #166).
   *
   * Its own column rather than a second meaning for {@link IntroRequest.decidedAt},
   * because the two are different people's timestamps and the interval between them is
   * the only record of how long an introduction sat unanswered. It is also what
   * {@link import('./intro-request.events').introResponded} reads for its `occurredAt`:
   * reusing `decidedAt` would emit an acceptance claiming to have happened when the via
   * acted.
   *
   * ⚠ **Not carried on any read but the answering target's own receipt.** The requester
   * must not be able to tell a decline from an unanswered introduction, and a timestamp
   * that appeared the moment somebody declined would say it as loudly as a status would.
   */
  readonly respondedAt?: Date;
}

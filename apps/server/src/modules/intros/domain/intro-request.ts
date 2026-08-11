/**
 * The three states an intro request can be in.
 *
 * ```
 * requested ──pass_on──▶ passed_on   (terminal for #89)
 *      └─────decline───▶ declined    (terminal)
 * ```
 *
 * A `text` column with a CHECK rather than an enum, matching
 * {@link import('../../connections/domain/connection').CONNECTION_STATUS}: adding a
 * state is then a migration rather than a type rewrite. What the *target* may do after
 * `passed_on` — connect, ignore — is deliberately out of scope for #89, because minting
 * a connection from an intro is a new authorization path and not a fourth value here.
 *
 * Exported so a consumer branching on status compares against this rather than
 * re-spelling the literal.
 */
export const INTRO_REQUEST_STATUS = {
  /** Waiting on the via. The only state the via's inbox shows. */
  requested: 'requested',
  /** The via passed it on. The only state the target ever sees. */
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
   */
  readonly decidedAt?: Date;
}

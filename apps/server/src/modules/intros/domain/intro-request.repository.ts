import type { IntroDecision, IntroRequest, IntroResponse } from './intro-request';

/** What requesting an intro is given. The note has already been through the policy. */
export interface NewIntroRequest {
  /** The requester, taken from the resolved `Actor` and never from request input. */
  readonly requesterId: string;
  /** Who they are asking to make the introduction. */
  readonly viaId: string;
  /** Who they want to meet. */
  readonly targetId: string;
  /**
   * Already trimmed and bounded by
   * {@link import('./intro-note.policy').validateIntroNote}.
   */
  readonly note: string;
  readonly createdAt: Date;
}

/** What deciding an intro request is given. */
export interface IntroDecisionWrite {
  readonly introRequestId: string;
  /**
   * The via, taken from the resolved `Actor`.
   *
   * ⚠ It is a *predicate* on the update, not a field written to the row: the statement's
   * `where via_id = <actor>` is what makes "only the named via may decide" true, and
   * there is no path here that writes an actor anywhere.
   */
  readonly actorId: string;
  readonly decision: IntroDecision;
  /**
   * The via's own note, already through
   * {@link import('./intro-note.policy').validateViaNote} — present for a `pass_on`,
   * **absent** for a `decline`.
   *
   * Absent rather than empty, so the column it lands in is null and the table's
   * `via_note is null or status = 'passed_on'` CHECK has something true to enforce.
   */
  readonly viaNote?: string;
  readonly decidedAt: Date;
}

/** What answering an introduction is given (issue #166). */
export interface IntroResponseWrite {
  readonly introRequestId: string;
  /**
   * The target, taken from the resolved `Actor`.
   *
   * ⚠ A *predicate* on the update, exactly as {@link IntroDecisionWrite.actorId} is: the
   * statement's `where target_id = <actor>` is what makes "only the target may answer"
   * true, and no path here writes an actor anywhere.
   */
  readonly actorId: string;
  readonly response: IntroResponse;
  readonly respondedAt: Date;
}

/**
 * The intro requests port — the **write** one.
 *
 * Declared here in `domain/` and implemented in `persistence/` (addendum §2). The three
 * role-scoped reads are viewer-scoped projections and live behind
 * {@link import('../application/visible-intros.repository').VisibleIntrosRepository}
 * instead, the same split `modules/notes` makes between `NoteRepository` and
 * `VisibleNotesRepository`. Keeping the two apart is what stops a convenience method on
 * this port from becoming a second visibility predicate (ADR-0002 §6).
 */
export interface IntroRequestRepository {
  /**
   * Write a request and its `IntroRequested` event, **atomically**, and only if the
   * named via is a genuine candidate for this requester and target.
   *
   * ⚠ **The authorization is part of the statement, not a prior read.** The insert is a
   * single `INSERT … SELECT … WHERE EXISTS (… app.intro_via_candidates …)`, so an
   * ineligible triple inserts **zero rows** and there is no window in which the graph
   * could change between a check and a write.
   *
   * ⚠ **The one-open-request-per-pair rule is enforced by the same statement**, through
   * `on conflict … do nothing` on the partial unique index. That is why a duplicate
   * comes back as the ordinary refusal instead of a unique-violation escaping as a 500 —
   * and why two concurrent requests for one pair leave exactly one row, with the loser
   * blocked on the index rather than racing a read.
   *
   * One transaction covering two writes, because a request nobody was told about and a
   * notification about a request that does not exist are both worse than neither
   * (addendum §10, ADR-0006).
   *
   * @throws {import('./intro-request.errors').IntroUnavailableError} when the statement
   *   wrote no row — the same answer for "not eligible", "no such person", "already
   *   asked", and "that is you".
   */
  request(write: NewIntroRequest): Promise<IntroRequest>;

  /**
   * Decide an open request as its named via, and write the matching event, atomically.
   *
   * ⚠ **`pass_on` re-checks eligibility inside the update; `decline` does not**, and the
   * asymmetry is the point. A request is not a snapshot: if the requester and via, or
   * the via and target, are no longer connected — or the target has lowered their reach
   * below the requester, or deactivated — then passing it on would disclose the
   * requester to somebody the current rules say may not be reached, so it is refused
   * with the ordinary error and the target learns nothing. Declining discloses nothing
   * to anybody, so it stays available for as long as the request is open: a via must
   * always be able to say no.
   *
   * ⚠ The via's note rides this same statement rather than a second write, for the reason
   * the event does: "passed on" and "here is what I said about it" are one fact, and a
   * row that reached `passed_on` while a follow-up note write failed would be an
   * introduction the target reads unvouched.
   *
   * @throws {import('./intro-request.errors').IntroUnavailableError} when the statement
   *   updated no row — "no such request", "not yours", "already decided", and "no longer
   *   eligible" are one answer.
   */
  decide(write: IntroDecisionWrite): Promise<IntroRequest>;

  /**
   * Answer a passed-on introduction as its named target, and write the matching event,
   * atomically (issue #166).
   *
   * ⚠ **`where target_id = <actor> and status = 'passed_on'` is the whole authorization,
   * and both halves matter.** The first makes "only the target may answer" true — the
   * requester, the via and a stranger each match zero rows, exactly as an id naming
   * nothing does. The second makes "only after the via passed it on" true, and doubles as
   * the terminal-once rule and the concurrency control: two simultaneous answers block on
   * the row, and the loser re-evaluates against the committed status, matches nothing, and
   * is refused.
   *
   * ⚠ **Eligibility is deliberately not re-checked, unlike a pass-on.** The graph question
   * a pass-on asks — may this requester be disclosed to this target — was already answered
   * when the introduction was made, and the target has since *read* it. Refusing the
   * answer now would withdraw nothing (they have already seen everything) while leaving
   * somebody unable to act on an introduction they were given, which is the failure mode
   * D3's asymmetry exists to avoid. Accepting is also consent in its own right: the target
   * is choosing this connection, not being placed in one.
   *
   * ⚠ **The connection is not written here.** An acceptance emits `IntroAccepted` and
   * `modules/connections` forms the edge from it (decision D12) — so this module names no
   * table it does not own, and a crash between the two leaves a delivery still owed rather
   * than an accepted introduction with no connection and no way to retry.
   *
   * @throws {import('./intro-request.errors').IntroUnavailableError} when the statement
   *   updated no row — "no such request", "not yours to answer", "not passed on yet",
   *   "the via declined it", and "already answered" are one answer.
   */
  respond(write: IntroResponseWrite): Promise<IntroRequest>;
}

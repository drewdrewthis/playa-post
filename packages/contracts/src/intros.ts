/**
 * The three states an intro request can be in.
 *
 * ```
 * requested ──pass on──▶ passed_on
 *      └──────decline───▶ declined
 * ```
 *
 * Both decisions are terminal. What a target may *do* after `passed_on` — connect,
 * ignore — is not part of this API yet.
 */
export const INTRO_REQUEST_STATUS = {
  /** Waiting on the via. Render "Intro pending via {name}". */
  requested: 'requested',
  /** The via passed it on. */
  passedOn: 'passed_on',
  /**
   * The via declined.
   *
   * ⚠ Render "not passed on", with **no reason and no re-ask control**. There is no
   * reason on the wire because there is none to send — the via's rationale is theirs —
   * and a re-ask button turns a decline into a prompt.
   */
  declined: 'declined',
} as const;

/** One of {@link INTRO_REQUEST_STATUS}'s values. */
export type IntroRequestStatus = (typeof INTRO_REQUEST_STATUS)[keyof typeof INTRO_REQUEST_STATUS];

/** What the via may do with a request they were sent. */
export const INTRO_DECISION = {
  passOn: 'pass_on',
  decline: 'decline',
} as const;

/** One of {@link INTRO_DECISION}'s values. */
export type IntroDecision = (typeof INTRO_DECISION)[keyof typeof INTRO_DECISION];

/** Which side of an intro you are standing on, in `intros.listInbox`. */
export const INTRO_INBOX_ROLE = {
  /** You were asked to make this introduction. Both other parties are named. */
  via: 'via',
  /** Somebody was introduced to you. Only the requester is named — the target is you. */
  target: 'target',
} as const;

/** One of {@link INTRO_INBOX_ROLE}'s values. */
export type IntroInboxRole = (typeof INTRO_INBOX_ROLE)[keyof typeof INTRO_INBOX_ROLE];

/**
 * A person on an intro surface, under the same §6a disclosure rule the graph, the board
 * and notes use.
 *
 * Absent name/handle/avatar means render **none of them** — see
 * {@link import('./graph').Person}. Not initials, not a truncated `userId`, not
 * "Unknown": any placeholder derived from the id re-identifies the person the projection
 * just hid. A `topology_only` via candidate is a chip with no name on it.
 *
 * ⚠ **Do not fill a missing name in from your own graph.** What the server withheld, it
 * withheld deliberately — and on this surface you are unusually likely to think you
 * already know the answer.
 */
export interface IntroPerson {
  readonly userId: string;
  readonly disclosure: string;
  readonly displayName?: string;
  readonly handle?: string;
  readonly avatarUrl?: string;
}

/**
 * `intros.viaCandidates` input.
 *
 * ⚠ **An unreachable, deactivated, or entirely invented `targetUserId` returns an empty
 * list, never an error.** Do not build a "does this person exist" probe out of it: the
 * answer is deliberately identical for "nobody" and "somebody you may not reach".
 *
 * The list is empty at degree 1 (no introduction is needed), at degree 3 or beyond (an
 * intro travels one hop), and at degree 2 when every person standing between you is
 * withheld by their own settings. **A no-candidates state disables submit** — never an
 * empty chip row above an enabled button.
 */
export interface IntroViaCandidatesRequest {
  readonly targetUserId: string;
}

/**
 * `intros.request` input.
 *
 * ⚠ **Sending this is consent to be seen.** If the via passes it on, the target is shown
 * your identity and your note *even if your own visibility setting would otherwise hide
 * you from somebody two hops away*. The sheet must say so before send.
 *
 * Every refusal — a target at the wrong distance, a via who does not know them, a person
 * who does not exist, or an ask you already have open with this person — comes back as
 * the identical `INTRO_UNAVAILABLE`. Do not branch on it for anything but a single
 * message.
 */
export interface RequestIntroRequest {
  readonly targetUserId: string;
  /** Who to ask. Must be one of {@link IntroViaCandidatesRequest}'s answers. */
  readonly viaUserId: string;
  /**
   * Why you want to meet them. At most 4000 characters after trimming, and never
   * empty — a whitespace-only note is refused with `INTRO_CONTENT_INVALID`.
   *
   * ⚠ Never searched, never indexed, and never carried in an event payload. The via
   * reads it to decide; the target reads it if the via passes it on; nobody else ever
   * does, and it is not echoed back to you on any response.
   */
  readonly note: string;
}

/** `intros.decide` input. The actor is always the via — there is no field for it. */
export interface DecideIntroRequest {
  readonly introRequestId: string;
  readonly decision: IntroDecision;
}

/**
 * An intro request as the party who just changed it sees one — `intros.request`'s and
 * `intros.decide`'s answer.
 *
 * ⚠ It carries **no `note`**: you wrote it, or you are the via who is reading it on your
 * inbox row. Echoing it here would persist a second copy of it wherever you store
 * mutation results.
 */
export interface IntroRequestReceipt {
  readonly id: string;
  readonly viaUserId: string;
  readonly targetUserId: string;
  readonly status: IntroRequestStatus;
  /** ISO-8601. */
  readonly createdAt: string;
  /** ISO-8601. Absent while the request is open. */
  readonly decidedAt?: string;
}

/**
 * One row of `intros.listInbox` — the **dual-role** read.
 *
 * ⚠ **Branch on `role`.** A `via` row is an ask waiting on your decision and names both
 * other people; a `target` row is an introduction already made to you and names the
 * requester only. Rendering a Pass on / Decline control on a `target` row offers an
 * action the server refuses.
 *
 * ⚠ **A declined request never appears here for its target, and neither does an open
 * one.** The absence is total: this response is byte-for-byte what somebody nobody has
 * ever asked about receives. Do not infer anything from an empty list.
 *
 * Both cards are optional, because a request outlives the relationship that carried it —
 * see {@link IntroPerson} for what an absent one means.
 */
export interface IntroInboxRow {
  readonly id: string;
  readonly role: IntroInboxRole;
  /** Why the requester wants the introduction. */
  readonly note: string;
  /** ISO-8601, newest first. */
  readonly createdAt: string;
  readonly requester?: IntroPerson;
  /** Present on a `via` row only. On a `target` row the target is you. */
  readonly target?: IntroPerson;
}

/**
 * One row of `intros.listOutbox` — what you asked, and what came of it.
 *
 * Carries all three states. `targetUserId` is a bare identifier rather than a card
 * because you supplied it: match it against the person you are already rendering from
 * `graph.list` to show "Intro pending via {name}" on their sheet.
 *
 * ⚠ No `note` (you wrote it) and no reason on a `declined` row (see
 * {@link INTRO_REQUEST_STATUS}).
 */
export interface IntroOutboxRow {
  readonly id: string;
  readonly status: IntroRequestStatus;
  readonly targetUserId: string;
  /** ISO-8601, newest first. */
  readonly createdAt: string;
  /** ISO-8601. Absent while the request is open. */
  readonly decidedAt?: string;
  /** Who you asked. Absent when you may no longer be told who they are. */
  readonly via?: IntroPerson;
}

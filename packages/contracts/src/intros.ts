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

/**
 * `intros.decide` input. The actor is always the via — there is no field for it.
 *
 * ⚠ **A union, not one object with an optional note**, because the two decisions take
 * different fields (#175).
 *
 * Passing an introduction on means **adding a note of your own**: the target reads the
 * requester's reason for asking and your reason for agreeing, each under its author's
 * card. It is required — a pass-on with nothing added comes back as
 * `INTRO_CONTENT_INVALID`, exactly as an empty note on `intros.request` does.
 *
 * ⚠ **A decline carries none, and sending one is refused rather than quietly dropped** —
 * the wire's strict decline shape rejects the unknown field as a plain `BAD_REQUEST`
 * carrying no application code. The requester is told only that it was not passed on — no
 * reason, no re-ask control (see {@link INTRO_REQUEST_STATUS}) — so text written on a
 * decline has no reader, and a field the server discarded in silence would let its writer
 * believe otherwise.
 */
export type DecideIntroRequest =
  | {
      readonly introRequestId: string;
      readonly decision: typeof INTRO_DECISION.passOn;
      /**
       * Why you are willing to make this introduction. Required, at most 4000 characters
       * after trimming, and never empty.
       *
       * ⚠ The target reads it; **the requester never does**, on any read. It is a vouch
       * written to one of the two people, and echoing it to the other would be the reason
       * nobody writes an honest one twice.
       */
      readonly note: string;
    }
  | {
      readonly introRequestId: string;
      readonly decision: typeof INTRO_DECISION.decline;
    };

/**
 * An intro request as the party who just changed it sees one — `intros.request`'s and
 * `intros.decide`'s answer.
 *
 * ⚠ It carries **no note of either kind**: the requester's, because you wrote it or you
 * are the via reading it on your own inbox row; and the via's, because you just wrote
 * that one. Echoing either here would persist a second copy wherever you store mutation
 * results.
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
 * ⚠ **A `target` row carries two notes by two different people** (#175), and each must be
 * rendered under its own author's card: `note` is the requester's ask, `viaNote` is the
 * via's vouch. Running them together, or attributing both to the requester, puts words in
 * somebody's mouth.
 *
 * Every card is optional, because a request outlives the relationship that carried it —
 * see {@link IntroPerson} for what an absent one means.
 */
export interface IntroInboxRow {
  readonly id: string;
  readonly role: IntroInboxRole;
  /** Why the requester wants the introduction. */
  readonly note: string;
  /**
   * What the via said when they passed it on.
   *
   * `target` rows only, and **absent even there** on an introduction passed on before
   * #175 required one — render the requester's half alone in that case, never an empty
   * quote attributed to the via.
   */
  readonly viaNote?: string;
  /** ISO-8601, newest first. */
  readonly createdAt: string;
  readonly requester?: IntroPerson;
  /**
   * Who passed it on — the author of {@link IntroInboxRow.viaNote}.
   *
   * Present on a `target` row only; on a `via` row the via is you. Absent when they can
   * no longer be described, in which case the note still renders, under the withheld
   * treatment and never under a name filled in from your own graph.
   */
  readonly via?: IntroPerson;
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
 *
 * ⚠ **And no `viaNote` on a `passed_on` row.** The via wrote that one to the person you
 * asked to meet, about you. `INTRO_PASSED_ON_LINE` — "they have your note now" — is the
 * whole of what this side is told.
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

/**
 * The five states an intro request can be in.
 *
 * ```
 * requested ──pass on──▶ passed_on ──accept───▶ accepted         (terminal)
 *      │                     └──────decline───▶ target_declined  (terminal)
 *      └──────decline───▶ declined                               (terminal)
 * ```
 *
 * ⚠ **Only three of them ever reach `intros.listOutbox`** (#166). The requester's own
 * record reports the *via's* decision and never the target's answer: `accepted` and
 * `target_declined` both read back there as `passed_on`, because a target who could be
 * seen refusing cannot safely refuse. Do not build a "did they say yes" indicator out of
 * that read — an acceptance announces itself by the connection it makes, on the graph.
 *
 * The two target states appear on `intros.respond`'s own receipt, to the target who just
 * wrote one, and nowhere else on this API.
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
  /**
   * The target accepted the introduction (#166) — `intros.respond`'s receipt only.
   *
   * ⚠ **The connection is not there yet when you read this.** Accepting records the
   * answer; the edge is written from it moments later, by the server's own event drainer.
   * A client that navigated straight to a connection-only surface on this status would
   * arrive early — re-read the graph, do not assume.
   */
  accepted: 'accepted',
  /**
   * The target declined the introduction (#166) — `intros.respond`'s receipt only.
   *
   * ⚠ **Never rendered to the requester, and there is no wire shape that could.** It is
   * `target_declined` rather than a second use of {@link INTRO_REQUEST_STATUS.declined}
   * so that a client filtering on "the via said no" cannot silently start matching rows
   * the target has read.
   */
  targetDeclined: 'target_declined',
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

/**
 * What the **target** may do with an introduction that was passed on to them (#166).
 *
 * Its own vocabulary rather than {@link INTRO_DECISION} reused, even though both spell one
 * value `decline`: a decision is the via's answer to "should these two meet at all", and a
 * response is the target's answer to "do I want to meet this person". One type for both
 * would let a client offer `pass_on` on a `target` row, which the server refuses.
 */
export const INTRO_RESPONSE = {
  /** Connect me with them. */
  accept: 'accept',
  /** No thanks. */
  decline: 'decline',
} as const;

/** One of {@link INTRO_RESPONSE}'s values. */
export type IntroResponse = (typeof INTRO_RESPONSE)[keyof typeof INTRO_RESPONSE];

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
 * `intros.respond` input — the target's answer to an introduction (#166).
 *
 * The actor is always the target; there is no field for it, and only the target of a
 * **passed-on** introduction may send this. Everything else — the requester, the via, a
 * stranger, an introduction already answered, one still waiting on its via, and one the
 * via declined — comes back as the identical `INTRO_UNAVAILABLE`. That last case is why:
 * a distinct refusal would tell a target the very thing a via's decline exists to hide.
 *
 * ⚠ **Neither answer carries a note, and sending one is refused rather than dropped.** An
 * acceptance says nothing beyond itself; a decline is never disclosed to anybody, so text
 * written on one has no reader at all.
 *
 * ⚠ **Accepting is what creates the connection, and it is not instant.** The server
 * records the answer and forms the edge from it moments later. Treat a successful response
 * as "this will connect", re-read the graph rather than assuming, and do not offer the
 * answer twice — a second one is refused.
 */
export interface RespondToIntroRequest {
  readonly introRequestId: string;
  readonly response: IntroResponse;
}

/**
 * An intro request as the party who just changed it sees one — `intros.request`'s,
 * `intros.decide`'s and `intros.respond`'s answer.
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
  /**
   * ISO-8601. When the target answered (#166) — present on `intros.respond`'s receipt and
   * absent on the other two, which can only ever have written an unanswered row.
   *
   * ⚠ It reaches no *read*. `intros.listOutbox` carries no answer time, so a requester
   * cannot tell a declined introduction from one nobody has got to yet.
   */
  readonly respondedAt?: string;
}

/**
 * One row of `intros.listInbox` — the **dual-role** read.
 *
 * ⚠ **Branch on `role`.** A `via` row is an ask waiting on your decision and names both
 * other people; a `target` row is an introduction already made to you and names the
 * requester only. The two take **different actions**: a `via` row's is `intros.decide`
 * (pass on with a note, or decline), a `target` row's is `intros.respond` (accept, or
 * decline). Offering either control on the other role's row offers an action the server
 * refuses.
 *
 * ⚠ **A declined request never appears here for its target, and neither does an open
 * one.** The absence is total: this response is byte-for-byte what somebody nobody has
 * ever asked about receives. Do not infer anything from an empty list.
 *
 * ⚠ **An answered introduction leaves this list too** (#166). An inbox is what is waiting
 * on you, so a `target` row disappears once it is accepted or declined — exactly as a
 * `via` row does once it is decided. Say so in a live region before the row goes; a card
 * that vanishes under the finger with nothing said reads as a failure.
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
 * Carries three states and only three — `requested`, `passed_on`, `declined`.
 * `targetUserId` is a bare identifier rather than a card because you supplied it: match it
 * against the person you are already rendering from `graph.list` to show "Intro pending
 * via {name}" on their sheet.
 *
 * ⚠ **`passed_on` here means "the via passed it on", and says nothing about what the
 * target did with it** (#166). An introduction they accepted, one they declined, and one
 * they have not opened all read identically — because a target who could be seen refusing
 * cannot safely refuse, which is the same rule that keeps a via's decline invisible one
 * person along. An acceptance still reaches you: it discloses itself by connecting.
 *
 * ⚠ No `note` (you wrote it), no reason on a `declined` row (see
 * {@link INTRO_REQUEST_STATUS}), and no answer time.
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

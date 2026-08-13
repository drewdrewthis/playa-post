/** `connections.invitations.create` output. The token is the whole invite. */
export interface Invite {
  readonly token: string;
}

/** Input of every procedure that spends or previews an invite token. */
export interface InviteTokenRequest {
  readonly token: string;
}

/** `connections.invitations.open` output — who the token would connect you to. */
export interface OpenedInvite {
  readonly inviterId: string;
}

/** `connections.connection.get` input. */
export interface GetConnectionRequest {
  readonly otherUserId: string;
}

/**
 * A connection as the **viewer** sees it.
 *
 * `trust` is the viewer's own directional value and reaches nobody else: for a
 * connection the viewer does not hold, the server *refuses* with a `NOT_FOUND`
 * carrying `NOT_CONNECTED` — this procedure never resolves for a stranger, so absence
 * is an error envelope, not a null payload (B6). Within a resolved connection, `null`
 * trust is *unset*, `0` is a deliberate zero — two states, and a client that collapses
 * them into one falsy branch has lost a user's explicit choice.
 */
export interface Connection {
  readonly status: string;
  readonly trust: number | null;
}

/** `connections.trust.set` input. */
export interface SetTrustRequest {
  readonly subjectUserId: string;
  readonly trust: number;
}

/**
 * Where the reader stands in relation to a personal link they just opened (issue #206).
 *
 * ⚠ **Branch on this rather than inferring from the card.** Every value is a fact about the
 * reader — nothing here says how many other people have asked, how full the owner's inbox
 * is, or when the link was last rotated.
 */
export const PERSONAL_LINK_VIEWER_STATE = {
  /** Your own link. Render the share and rotate controls, never a request button. */
  own: 'own',
  /** Already connected. There is nothing to ask for; offer their person sheet instead. */
  connected: 'connected',
  /** You already have a request waiting on this person. Render the sent state, disabled. */
  requested: 'requested',
  /** Nothing in the way. The request button is the screen. */
  open: 'open',
} as const;

/** One of {@link PERSONAL_LINK_VIEWER_STATE}'s values. */
export type PersonalLinkViewerState =
  (typeof PERSONAL_LINK_VIEWER_STATE)[keyof typeof PERSONAL_LINK_VIEWER_STATE];

/**
 * The three states a connection request can be in (issue #206).
 *
 * ⚠ **Only `pending` ever reaches a *read*.** `connections.requests.listInbox` serves the
 * owner's waiting requests and nothing else, and there is no requester-side read at all —
 * `accepted` and `declined` appear only on `connections.requests.decide`'s own receipt, to
 * the owner who just wrote one. Do not build a "did they say yes" indicator: a requester who
 * could tell a decline from an unanswered request would make declining unsafe for the owner,
 * which is the same rule ADR-0017 rests on. An acceptance still reaches them — it discloses
 * itself by connecting, on the graph.
 */
export const CONNECTION_REQUEST_STATUS = {
  pending: 'pending',
  accepted: 'accepted',
  declined: 'declined',
} as const;

/** One of {@link CONNECTION_REQUEST_STATUS}'s values. */
export type ConnectionRequestStatus =
  (typeof CONNECTION_REQUEST_STATUS)[keyof typeof CONNECTION_REQUEST_STATUS];

/** What the owner may do with a request waiting on them. */
export const CONNECTION_REQUEST_DECISION = {
  /** Connect us. The edge exists by the time this resolves. */
  accept: 'accept',
  /** No thanks. Reaches nobody. */
  decline: 'decline',
} as const;

/** One of {@link CONNECTION_REQUEST_DECISION}'s values. */
export type ConnectionRequestDecision =
  (typeof CONNECTION_REQUEST_DECISION)[keyof typeof CONNECTION_REQUEST_DECISION];

/**
 * A person on a connections surface, under the same §6a disclosure rule the graph, the board
 * and intros use.
 *
 * Absent name/handle/avatar means render **none of them** — see
 * {@link import('./graph').Person}. Not initials, not a truncated `userId`, not "Unknown":
 * any placeholder derived from the id re-identifies the person the projection just hid.
 *
 * ⚠ **Do not fill a missing name in from your own graph.** What the server withheld, it
 * withheld deliberately.
 */
export interface ConnectionPerson {
  readonly userId: string;
  readonly disclosure: string;
  readonly displayName?: string;
  readonly handle?: string;
  readonly avatarUrl?: string;
}

/**
 * The caller's own personal link — `connections.personalLink.ensure`'s and
 * `connections.personalLink.rotate`'s answer (issue #206).
 *
 * ⚠ **It is permanent and infinitely reusable.** Opening it connects nobody: a visitor sees
 * the owner's name and a button that asks, and the owner accepts or declines. That is the
 * whole difference from {@link Invite}, which is a single-use bearer token that dies the
 * moment somebody spends it.
 *
 * ⚠ **The slug is not a URL.** Build one with the app's own origin — a URL assembled by the
 * server would bake whichever host served the request into something people paste into
 * chats, and one minted through a preview deployment would outlive it.
 */
export interface PersonalLink {
  readonly slug: string;
  /** ISO-8601. When this person's link first existed. A rotation does not reset it. */
  readonly createdAt: string;
  /** ISO-8601. Absent until the first rotation; the most recent one after that. */
  readonly rotatedAt?: string;
}

/** Input of every procedure that takes a personal-link slug. */
export interface PersonalLinkSlugRequest {
  /**
   * The slug from a `/c/:slug` URL.
   *
   * ⚠ Every string that is not a live slug — invented, malformed, or one the owner has
   * rotated away from — comes back as the identical `PERSONAL_LINK_UNAVAILABLE`. Do not
   * branch on it for anything but a single neutral message, and **never** say "that link was
   * retired": whoever kept the old URL is frequently the reason it was rotated.
   */
  readonly slug: string;
}

/**
 * `connections.personalLink.open`'s answer — who this address belongs to (issue #206).
 *
 * ⚠ **Opening changes nothing.** This is a read; asking is a separate, explicit mutation,
 * and even that only puts a row on somebody's inbox.
 *
 * ⚠ The owner is named to you even if you are a total stranger, because they published the
 * link. That is their consent, not a leak — and it is still the §6a projection, so a
 * deactivated owner has no card and the whole read refuses with the neutral message.
 */
export interface OpenedPersonalLink {
  readonly owner: ConnectionPerson;
  readonly viewerState: PersonalLinkViewerState;
}

/**
 * A connection request as the party who just changed it sees one —
 * `connections.requests.send`'s and `connections.requests.decide`'s answer.
 *
 * ⚠ It carries **no person card**: on a send you already have the owner's from
 * `connections.personalLink.open`, and on a decide you have the requester's from your inbox.
 *
 * ⚠ **`accepted` here means connected, now.** Unlike an accepted introduction — which
 * records an answer and forms the edge moments later — this writes the connection in the
 * same transaction. Re-read the graph to render it, but you may say "you are connected"
 * rather than "you are being connected".
 */
export interface ConnectionRequestReceipt {
  readonly id: string;
  readonly status: ConnectionRequestStatus;
  /** ISO-8601. */
  readonly createdAt: string;
  /** ISO-8601. Absent while the request is open. */
  readonly decidedAt?: string;
}

/**
 * One row of `connections.requests.listInbox` — what is waiting on you (issue #206).
 *
 * ⚠ **Every row is pending**, which is why there is no status field. A request you answer
 * leaves this list, and so does one that reaches fourteen days unanswered — say so in a live
 * region before the row goes, because a card that vanishes under the finger with nothing
 * said reads as a failure.
 *
 * ⚠ **The requester is always named**, at their own full self-disclosure, because asking
 * through your link is their consent to be seen by you. A requester who deactivates takes
 * their whole row out of this list rather than leaving a nameless Accept button behind.
 */
export interface IncomingConnectionRequest {
  readonly id: string;
  /** ISO-8601, newest first. */
  readonly createdAt: string;
  readonly requester: ConnectionPerson;
}

/**
 * `connections.requests.decide`'s input. The actor is always the owner — there is no field
 * for it.
 *
 * ⚠ **Neither answer carries a note, and sending one is refused rather than dropped.** An
 * acceptance says nothing beyond itself; a decline is never disclosed to anybody, so text
 * written on one has no reader.
 *
 * Every refusal is the identical `CONNECTION_REQUEST_UNAVAILABLE`: no such request, not
 * yours, already decided, and lapsed are one answer.
 */
export interface DecideConnectionRequestRequest {
  readonly connectionRequestId: string;
  readonly decision: ConnectionRequestDecision;
}

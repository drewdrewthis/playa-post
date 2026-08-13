import type { ConnectionPerson } from './connection-person';

/**
 * Where the reader already stands in relation to the link they just opened (issue #206).
 *
 * ⚠ **Every value is a fact about the reader, never about the owner.** "You are already
 * connected" and "you already asked" are things the caller could work out from their own
 * graph and their own history; nothing here reports how many other people have asked, how
 * full the owner's inbox is, or how recently the link was rotated. That boundary is what
 * keeps this read from becoming the oracle
 * {@link import('../domain/personal-link.errors').PersonalLinkUnavailableError} closes on
 * the write path.
 */
export const PERSONAL_LINK_VIEWER_STATE = {
  /** The reader's own link. Render the share/rotate view, not a request button. */
  own: 'own',
  /** Already connected. There is nothing to ask for. */
  connected: 'connected',
  /** The reader has a live request waiting on this owner. Render the sent state. */
  requested: 'requested',
  /** Nothing in the way. The request button is the whole screen. */
  open: 'open',
} as const;

/** One of {@link PERSONAL_LINK_VIEWER_STATE}'s values. */
export type PersonalLinkViewerState =
  (typeof PERSONAL_LINK_VIEWER_STATE)[keyof typeof PERSONAL_LINK_VIEWER_STATE];

/**
 * What the database answered about a slug — the raw facts, before they are collapsed into
 * a state.
 *
 * Kept separate from {@link OpenedPersonalLink} so the collapsing is a pure function this
 * module can test at the boundaries, rather than a `case` inside a SQL statement where the
 * precedence between "already connected" and "already asked" would be invisible.
 */
export interface OpenedPersonalLinkFacts {
  /** Whose link it is, §6a-projected from their own self-projection. */
  readonly owner: ConnectionPerson;
  /** Are the reader and the owner already connected? */
  readonly connected: boolean;
  /** Does the reader have a live, unlapsed request waiting on this owner? */
  readonly requestPending: boolean;
}

/**
 * A personal link as its opener sees it.
 *
 * ⚠ **The owner is named to somebody who may be a total stranger, and that is the feature**
 * (issue #206, ADR-0018 D1). It is the consent inversion ADR-0017 D4 established, applied
 * to a link the owner *published*: they chose to be identifiable to whoever holds it. It is
 * still §6a — the card comes out of `app.visible_people(owner, 0, 1)`, so a deactivated
 * owner has no card and therefore no link, and nothing is assembled by joining `app.users`.
 *
 * ⚠ **Opening connects nobody.** This read exists so the opener can see who they would be
 * asking before they ask. Everything that follows is a separate, explicit mutation the
 * owner still has to answer.
 */
export interface OpenedPersonalLink {
  readonly owner: ConnectionPerson;
  readonly viewerState: PersonalLinkViewerState;
}

/**
 * Collapse the facts into the one state a client should render.
 *
 * ⚠ **The precedence is deliberate and total**, and it is checked in this order because
 * each earlier answer makes the later ones meaningless rather than merely less
 * interesting: your own link cannot be requested, and a connection you already have is not
 * something to ask for again. A reader who is both connected *and* holding a stale pending
 * row — reachable when a pair connects through an invite while a request is open — is shown
 * `connected`, because that is the true state of the relationship and a "request sent"
 * screen would be a lie about what happens next.
 *
 * @param facts - What the database answered.
 * @param viewerId - The reading actor's `app.users.id`, from `ctx.actor`. Never from input.
 */
export function toOpenedPersonalLink(
  facts: OpenedPersonalLinkFacts,
  viewerId: string,
): OpenedPersonalLink {
  return {
    owner: facts.owner,
    viewerState: viewerStateOf(facts, viewerId),
  };
}

function viewerStateOf(facts: OpenedPersonalLinkFacts, viewerId: string): PersonalLinkViewerState {
  if (facts.owner.userId === viewerId) {
    return PERSONAL_LINK_VIEWER_STATE.own;
  }

  if (facts.connected) {
    return PERSONAL_LINK_VIEWER_STATE.connected;
  }

  if (facts.requestPending) {
    return PERSONAL_LINK_VIEWER_STATE.requested;
  }

  return PERSONAL_LINK_VIEWER_STATE.open;
}

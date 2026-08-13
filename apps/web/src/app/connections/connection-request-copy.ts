import type { ConnectionPerson } from '@playa-post/contracts';

import { nodeLabel } from '../graph/graph-node-identity';

/**
 * Every sentence the personal-link surfaces say, and the one function that decides what a
 * person on them may be called (issue #206).
 *
 * ⚠ **The name comes from {@link nodeLabel} and from nowhere else**, the rule
 * `intros/intro-copy.ts` and `notes/note-recipient.ts` both state. A second spelling of a
 * privacy rule is how two spellings drift.
 */

/**
 * What this viewer may call a person on a personal-link surface, or `null` when the
 * projection disclosed nothing.
 *
 * In practice a link owner and a requester are both projected from their own self-projection
 * and therefore always named — but "in practice" is a fact about today's SQL, and a copy
 * function that assumed it would render `undefined` into a sentence the day that changed.
 */
export function connectionPersonName(person: ConnectionPerson | undefined): string | null {
  return (person === undefined ? undefined : nodeLabel(person)) ?? null;
}

/** The `/c/:slug` screen's heading, before anything is pressed. */
export function personalLinkTitle(name: string | null): string {
  return name === null ? 'Connect with them' : `Connect with ${name}`;
}

/**
 * The line under the owner's name, before the request is sent.
 *
 * ⚠ **It says the owner decides, and it says it before the button is pressed.** Somebody
 * arriving from a QR at a party expects a tap to connect them — that is what the old invite
 * link did, and it is what produced issue #206's failure. A person who presses expecting a
 * connection and gets a pending request has been misled by the screen, not by the server.
 */
export const PERSONAL_LINK_ASK_LINE =
  'Sending a request does not connect you. They will see it and decide.';

/** The request control on the `/c/:slug` screen. */
export const SEND_CONNECTION_REQUEST_LABEL = 'Send connection request';

/**
 * What the requester reads once their request is in.
 *
 * ⚠ **It promises no answer and no notification of one.** An owner may decline, and a
 * decline reaches nobody — so a line saying "we will let you know" would be false in exactly
 * the case the reader most wants to know about. An acceptance discloses itself: they appear
 * on the graph.
 */
export const CONNECTION_REQUEST_SENT_LINE =
  'Request sent. If they accept, they will appear on your graph.';

/** What somebody opening a link they are already connected through reads. */
export const ALREADY_CONNECTED_LINE = 'You are already connected.';

/** What somebody opening their own link reads. */
export const OWN_LINK_LINE = 'This is your own link. Share it from the You screen.';

/**
 * The neutral unavailable state — the whole of what any failed link resolution says.
 *
 * ⚠ **One sentence for every cause, and it must never grow a second.** An invented slug, a
 * malformed one, a link whose owner has deactivated, and a link the owner has **rotated away
 * from** all produce it. The rotated case is why "that link was retired" can never be said:
 * whoever is holding the old URL is frequently the person the owner rotated to get away
 * from, and telling them the link was real and deliberately replaced is the disclosure the
 * server's uniform refusal exists to prevent.
 */
export const PERSONAL_LINK_UNAVAILABLE_LINE = 'This link is not available.';

/** What the `/c/:slug` screen says while the read is in flight. */
export const PERSONAL_LINK_OPENING_LINE = 'Opening this link…';

/** The owner's inbox heading. */
export const CONNECTION_REQUEST_INBOX_TITLE = 'Requests';

/** What the owner reads above their two controls, before either is pressed. */
export const CONNECTION_REQUEST_ANSWER_LINE =
  'Accepting connects you. Declining tells them nothing — they never learn either way.';

/** The owner's accept control. */
export const CONNECTION_REQUEST_ACCEPT_LABEL = 'Accept';

/**
 * The owner's decline control.
 *
 * ⚠ **"Decline", not "Not now".** The answer is terminal-once — the row leaves the inbox and
 * a second answer is refused — so a label promising deferral would be a lie told at the exact
 * moment the reader is deciding whether to refuse. It is not a block either: a declined pair
 * may ask again through the same link, because a refusal the requester cannot see must not
 * also be a decision they can never revisit.
 */
export const CONNECTION_REQUEST_DECLINE_LABEL = 'Decline';

/**
 * What the owner reads after answering, keyed by the decision.
 *
 * The row disappears on the re-read, and a card that vanishes under the finger with nothing
 * said reads as a failure — especially to a screen-reader user, whose focus was on the button
 * that just left the tree.
 *
 * ⚠ **The acceptance line says the connection exists, in the past tense, and that is a
 * deliberate difference from the intro one.** An accepted introduction records an answer and
 * forms the edge moments later (decision D12), so its copy has to say "you are being
 * connected". Here the edge is written by the same transaction, so the graph is already
 * right and the honest tense is the finished one.
 */
export const CONNECTION_REQUEST_CONFIRMATION_LINE = {
  accept: 'Accepted — you are connected.',
  decline: 'Declined. They are not told, and nothing is connected.',
} as const;

/** How the owner is told somebody is waiting, in the row's own lede. */
export const CONNECTION_REQUEST_LEDE = 'used your link and would like to connect.';

/** The You screen's label above the link itself. */
export const PERSONAL_LINK_CARD_LINE =
  'Your permanent link. Anyone who opens it sees your name and can ask to connect — you decide each one.';

/** The rotate control on the You screen. */
export const ROTATE_PERSONAL_LINK_LABEL = 'Get a new link';

/**
 * What sits beside the rotate control.
 *
 * ⚠ **It states both halves, and the second is what makes rotating usable.** People do not
 * press a destructive-looking button without knowing its blast radius, and the whole product
 * argument for a rotatable link is that rotating is cheap. Saying that connections and
 * received requests survive is what turns "get a new link" from a decision into a tap.
 */
export const ROTATE_PERSONAL_LINK_LINE =
  'Old copies of your link stop working. Your connections and any requests you have already received are untouched.';

/** What the owner reads once a rotation lands. */
export const PERSONAL_LINK_ROTATED_LINE = 'New link ready. The old one no longer opens.';

/**
 * The two server codes these surfaces can provoke, in words.
 *
 * ⚠ Both are rendered as flat sentences and **never elaborated**. `PERSONAL_LINK_UNAVAILABLE`
 * comes back identically for an unknown slug, a rotated one, a deactivated owner, your own
 * link, a pair already connected, a request already open, a full inbox and a rate-limited
 * link; `CONNECTION_REQUEST_UNAVAILABLE` for no such request, one that is not yours, one
 * already decided and one that has lapsed. Any added detail here would be this client
 * inventing the distinctions the server spent its design refusing to make — and in the
 * rotated case, inventing the one that matters most.
 */
export const CONNECTION_REQUEST_UNAVAILABLE_LINE = 'That request is no longer available.';

const REFUSAL_MESSAGE: Readonly<Record<string, string>> = {
  PERSONAL_LINK_UNAVAILABLE: PERSONAL_LINK_UNAVAILABLE_LINE,
  CONNECTION_REQUEST_UNAVAILABLE: CONNECTION_REQUEST_UNAVAILABLE_LINE,
};

/**
 * Read a refused call as something to say.
 *
 * @param code - the application code off the error envelope, or `null` when the failure was
 *   not the server refusing (a dropped connection has no code, and must not be rendered as
 *   one).
 */
export function connectionRefusalMessage(code: string | null): string {
  if (code === null) {
    return 'That did not send. Try again.';
  }

  return REFUSAL_MESSAGE[code] ?? `The server refused this: ${code}`;
}

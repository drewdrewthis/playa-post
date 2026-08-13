import type { ConnectionPerson } from '../application/connection-person';
import type {
  OpenedPersonalLink,
  PersonalLinkViewerState,
} from '../application/opened-personal-link';
import type { VisibleConnectionRequest } from '../application/visible-connection-request';
import type { ConnectionRequest, ConnectionRequestStatus } from '../domain/connection-request';
import type { PersonalLink } from '../domain/personal-link';

/**
 * A person as this API renders one on a connections surface.
 *
 * The same shape as the {@link ConnectionPerson} read model, restated here rather than
 * re-exported, because the wire is a contract and the read model is an implementation (the
 * same argument `modules/intros`' and `modules/graph`'s presenters make).
 *
 * ⚠ Nothing is *added* here, and that is the rule ADR-0002 §6a states: every person
 * representation is projected through `app.visible_people`'s disclosure level, no
 * exceptions. A presenter that filled in a missing name from anywhere else — the reader's
 * own graph, a cache, a connection they remember — would be exactly the bug B5's
 * person-projection sub-case asserts against.
 */
export interface PresentedConnectionPerson {
  readonly userId: string;
  readonly disclosure: string;
  readonly displayName?: string;
  readonly handle?: string;
  readonly avatarUrl?: string;
}

/**
 * The caller's own personal link — `personalLink.ensure`'s and `personalLink.rotate`'s
 * answer.
 *
 * ⚠ It carries **the slug and never a full URL.** The origin is the client's own — a
 * server-built URL would bake whichever host happened to serve the request into something
 * people paste into chats, and a link minted through a preview deployment would outlive it.
 * `apps/web`'s `personalLinkUrl(origin, slug)` is the one place a URL is assembled.
 *
 * ⚠ It carries **no request count and no rotation history**. How many people have asked
 * through this link is a fact about other people, and a previous slug is exactly what
 * rotation exists to make unrecoverable.
 */
export interface PresentedPersonalLink {
  readonly slug: string;
  /** ISO-8601. When this person's link first existed — unchanged by a rotation. */
  readonly createdAt: string;
  /** ISO-8601. Absent until the first rotation; the most recent one after that. */
  readonly rotatedAt?: string;
}

/**
 * Somebody else's link, as the person who opened it sees it — `personalLink.open`'s answer.
 *
 * ⚠ **The owner is named to a caller who may be a total stranger**, which is the feature
 * rather than a §6a exception (issue #206): publishing the address is the consent, and the
 * card still comes out of `app.visible_people`. A deactivated owner has no card and
 * therefore no link — the whole read refuses.
 */
export interface PresentedOpenedPersonalLink {
  readonly owner: PresentedConnectionPerson;
  /** Where the reader already stands. Branch on this rather than inferring from the card. */
  readonly viewerState: PersonalLinkViewerState;
}

/**
 * A connection request as this API renders one back to the party who just changed it —
 * `requests.send`'s and `requests.decide`'s answer.
 *
 * One type for both, because they answer the same question ("what does this row look like
 * now") to somebody who is already a party to it.
 *
 * ⚠ It carries **no person card**. On `send` the requester already has the owner's card from
 * `personalLink.open`; on `decide` the owner has the requester's from their inbox. A card
 * built on a write path would be a person projection assembled outside a read that composed
 * `app.visible_people`.
 *
 * ⚠ **`status` is safe here and reaches no other surface.** The requester sees `pending` on
 * their own receipt and never reads the row again — there is no requester-side list, which
 * is what keeps a decline indistinguishable from a request nobody answered (ADR-0018 D6).
 *
 * Timestamps are ISO-8601 strings rather than `Date`s. tRPC without a serializer turns a
 * `Date` into a string on the wire anyway, so declaring the string is declaring what a client
 * actually receives instead of a type that is true only in-process.
 */
export interface PresentedConnectionRequest {
  readonly id: string;
  readonly status: ConnectionRequestStatus;
  readonly createdAt: string;
  /** ISO-8601. Absent while the request is open. */
  readonly decidedAt?: string;
}

/**
 * One row of the owner's inbox — `requests.listInbox`'s rows.
 *
 * ⚠ No status field: every row is `pending` by construction, and a field that could say
 * otherwise would be a field a client could filter on for rows this read must not serve.
 */
export interface PresentedIncomingConnectionRequest {
  readonly id: string;
  readonly createdAt: string;
  readonly requester: PresentedConnectionPerson;
}

/**
 * Project one already-projected person onto the wire.
 *
 * A field-by-field copy rather than a spread: a spread would carry whatever the read model
 * grows next into every client payload without anyone deciding it should be there, and "the
 * field appeared in the response because someone added it upstream" is how §6a gets violated
 * by accident.
 */
function presentPerson(person: ConnectionPerson): PresentedConnectionPerson {
  return {
    userId: person.userId,
    disclosure: person.disclosure,
    ...(person.displayName === undefined ? {} : { displayName: person.displayName }),
    ...(person.handle === undefined ? {} : { handle: person.handle }),
    ...(person.avatarUrl === undefined ? {} : { avatarUrl: person.avatarUrl }),
  };
}

/** Project the caller's own link onto the wire. */
export function presentPersonalLink(link: PersonalLink): PresentedPersonalLink {
  return {
    slug: link.slug,
    createdAt: link.createdAt.toISOString(),
    ...(link.rotatedAt === undefined ? {} : { rotatedAt: link.rotatedAt.toISOString() }),
  };
}

/** Project somebody else's opened link onto the wire. */
export function presentOpenedPersonalLink(
  opened: OpenedPersonalLink,
): PresentedOpenedPersonalLink {
  return {
    owner: presentPerson(opened.owner),
    viewerState: opened.viewerState,
  };
}

/** Project the acting party's own view of a request they just wrote or decided. */
export function presentConnectionRequest(
  request: ConnectionRequest,
): PresentedConnectionRequest {
  return {
    id: request.id,
    status: request.status,
    createdAt: request.createdAt.toISOString(),
    ...(request.decidedAt === undefined ? {} : { decidedAt: request.decidedAt.toISOString() }),
  };
}

/** Project one inbox row onto the wire. */
export function presentIncomingConnectionRequest(
  row: VisibleConnectionRequest,
): PresentedIncomingConnectionRequest {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    requester: presentPerson(row.requester),
  };
}

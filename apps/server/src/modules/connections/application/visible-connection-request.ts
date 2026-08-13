import type { ConnectionPerson } from './connection-person';

/**
 * One row of the owner's connection-request inbox (issue #206).
 *
 * ⚠ **Pending rows only, and never a decided or lapsed one.** An inbox is what is waiting
 * on you: an accepted request became a connection and lives on the graph, a declined one is
 * finished, and a lapsed one is gone by arithmetic against
 * {@link import('../domain/connection-request.policy').CONNECTION_REQUEST_TTL_DAYS}. There
 * is no status field here because there is only ever one status — a client that could
 * filter by status would be a client that could ask for rows this read must not serve.
 *
 * ⚠ **The requester's card comes from their own self-projection**, `app.visible_people(
 * requester, 0, 1)`, and not from the owner's world — the consent inversion ADR-0017 D4
 * established. Asking through somebody's published link is the consent to be named to them,
 * so a requester whose own `visible_to_distance` would hide them from a stranger is still
 * shown here, at their own `full` self-disclosure. It is still `app.visible_people`, so §6a
 * holds and nothing is assembled by joining `app.users`.
 *
 * ⚠ **The card is required, not optional, and that is a lifecycle decision** rather than a
 * convenience. The read joins the projection *inner*, so a requester who has since
 * deactivated takes their whole row out of the inbox instead of leaving a nameless one
 * behind — an unnamed "somebody wants to connect" with an Accept button under it is a
 * consent decision with nothing to consent to. It is also self-healing: reactivating
 * restores the row, if it has not lapsed meanwhile (ADR-0002 B11).
 *
 * ⚠ **There is no note and no message field.** A request carries nothing but who and when
 * (ADR-0018 D4): free text from an unrequested stranger is an abuse channel with a
 * moderation queue attached, and the link the owner published is already the introduction.
 */
export interface VisibleConnectionRequest {
  readonly id: string;
  /** Newest first. */
  readonly createdAt: Date;
  /** Who asked, at their own `full` self-disclosure. */
  readonly requester: ConnectionPerson;
}

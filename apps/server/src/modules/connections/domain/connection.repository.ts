import type { Connection } from './connection';
import type { ConnectionAccepted } from './connection.events';
import type { Invitation } from './invitation';

/** What acceptance is given. The invite is already known to be spendable by this actor. */
export interface AcceptInvitationWrite {
  /** The `pending` invite being spent, read within the same use case. */
  readonly invitation: Invitation;
  /** The actor accepting. Already checked not to be the inviter. */
  readonly inviteeId: string;
  readonly occurredAt: Date;
}

/** What acceptance produced. */
export interface AcceptedConnection {
  readonly connection: Connection;
  /**
   * The event that was appended to the outbox, or `null` when this acceptance changed
   * nothing — the two were already connected, so no new fact occurred and no consumer
   * should be told one did.
   */
  readonly event: ConnectionAccepted | null;
}

/**
 * The connections port.
 *
 * Declared here in `domain/` and implemented in `persistence/` (addendum §2).
 */
export interface ConnectionRepository {
  /**
   * The accepted connection between two people, in whichever order it was stored.
   *
   * @returns `null` when there is none — an ordinary answer, which callers turn into
   *   `NOT_CONNECTED` or into "nothing to return" depending on what they were asked.
   */
  findBetween(oneUserId: string, otherUserId: string): Promise<Connection | null>;

  /**
   * Spend an invite and connect the two people, **atomically**.
   *
   * One transaction covering three writes, because the middle one is the state change
   * and the other two are what make it legible:
   *
   * 1. `app.invitations` → `accepted`, recording who spent it. Conditional on the row
   *    still being `pending`, so two concurrent acceptances cannot both win.
   * 2. `app.connections` → the new row, or nothing if the pair is already connected.
   * 3. `app.outbox_events` → `ConnectionAccepted` (addendum §10, ADR-0006). A queue
   *    publish outside the transaction is the dual-write bug: the commit succeeds, the
   *    publish fails, and the two diverge with nothing to reconcile them.
   *
   * M2-AC19 asserts the other direction of the same property: a refused acceptance
   * leaves **zero** rows in `app.connections` and **zero** in `app.outbox_events`.
   *
   * @throws {import('./invitation.errors').InvitationUnavailableError} if the invite
   *   stopped being `pending` between the read and this write.
   */
  acceptInvitation(write: AcceptInvitationWrite): Promise<AcceptedConnection>;
}

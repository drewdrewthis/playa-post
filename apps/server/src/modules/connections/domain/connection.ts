/**
 * The states a connection can be in.
 *
 * One value today. Removal and blocking are M5 (`connections.feature`'s own scope
 * comment), and they arrive as new states here rather than as deletions — a deleted
 * row cannot answer "we used to be connected", which is what a block has to know.
 */
export const CONNECTION_STATUS = {
  accepted: 'accepted',
} as const;

/**
 * An accepted connection, as `app.connections` stores one.
 *
 * Undirected membership, directional disclosure. **There is no trust field here and
 * there must never be one** — trust lives in its own table so that a query which
 * forgets to join simply has nothing to leak (ratified decision (b), ADR-0002 B6).
 *
 * `status` and the disclosure levels are typed `string` for the reason
 * `modules/identity/domain/user.ts` gives for `User.status`: the columns carry no
 * check constraint, so an unrecognised value is reachable, and every consumer here
 * fails closed on one.
 */
export interface Connection {
  readonly id: string;
  readonly userAId: string;
  readonly userBId: string;
  readonly status: string;
  /**
   * What `userAId` grants `userBId`: `full` or `limited`.
   *
   * Carried for completeness and read by nobody in this module. The level that
   * matters is the one `app.visible_people` *computes* from it per viewer (ADR-0004
   * decision 3), and changing a setting is M5 — so a policy object here now would be
   * a vocabulary with no caller.
   */
  readonly aDisclosesToBLevel: string;
  /** What `userBId` grants `userAId`. See {@link Connection.aDisclosesToBLevel}. */
  readonly bDisclosesToALevel: string;
  readonly createdAt: Date;
}

/**
 * Store one pair in one order, whoever accepted.
 *
 * `app.connections` has a unique constraint on `(user_a_id, user_b_id)`, and a
 * constraint on an unordered pair only works if the writer picks an order. Lexical
 * order of the two IDs is arbitrary and that is the point: it is stable, it needs no
 * lookup, and it makes "are these two already connected" one index probe instead of
 * two.
 *
 * ⚠ Readers must not rely on it. Fixtures and pre-existing rows may be stored either
 * way round, so every read matches both orders — see `app.visible_people`, which walks
 * each connection as two directed edges for exactly this reason.
 */
export function orderedPair(oneUserId: string, otherUserId: string): readonly [string, string] {
  return oneUserId < otherUserId ? [oneUserId, otherUserId] : [otherUserId, oneUserId];
}

/**
 * The states an invite moves through.
 *
 * A frozen object rather than a bare union so the values have one home and a
 * comparison cannot be written against a typo'd literal — the same shape
 * `modules/identity/domain/user.ts` uses for `USER_STATUS`.
 */
export const INVITATION_STATUS = {
  /** Unspent. The only state that can be opened or accepted. */
  pending: 'pending',
  /** Spent. Idempotent for whoever spent it; refused for everyone else. */
  accepted: 'accepted',
  /** Withdrawn by the inviter. Terminal (ADR-0005's "revoked authorization wins"). */
  revoked: 'revoked',
} as const;

/** One of {@link INVITATION_STATUS}'s values. */
export type InvitationStatus = (typeof INVITATION_STATUS)[keyof typeof INVITATION_STATUS];

/**
 * An invite, as `app.invitations` stores one.
 *
 * `status` is typed `string`, not {@link InvitationStatus}, for the reason
 * `modules/identity/domain/user.ts` gives for `User.status`: the column carries no
 * check constraint, so an unrecognised value is reachable, and narrowing it in the
 * mapper would mean either an unchecked cast or a throw that turns one bad row into a
 * 500. Left wide, {@link isOpenable} fails **closed** on anything it does not
 * recognise.
 */
export interface Invitation {
  readonly id: string;
  readonly inviterId: string;
  /** Opaque, CSPRNG, not derived from the inviter (M2-AC17). */
  readonly token: string;
  readonly status: string;
  readonly createdAt: Date;
  /** The `app.users.id` that spent it, or `null` while it is unspent. */
  readonly acceptedById: string | null;
  readonly acceptedAt: Date | null;
  readonly revokedAt: Date | null;
}

/**
 * May this invite still be opened or accepted?
 *
 * Only `pending`. Spent, revoked, and anything unrecognised all mean no — one answer,
 * because the differences are the inviter's business and a caller holding a token
 * should not be able to read the invite's history off the refusal (ADR-0002 §10).
 */
export function isOpenable(invitation: Invitation): boolean {
  return invitation.status === INVITATION_STATUS.pending;
}

/**
 * Did this actor already spend this invite?
 *
 * The one distinction acceptance is allowed to make. `connections.feature`'s
 * "accepting an already-accepted invite is idempotent" and M2-AC18's "accepting
 * twice" are the same event seen from two sides: the person who accepted gets their
 * connection back, everybody else gets `INVITATION_UNAVAILABLE`. Without
 * `acceptedById` the two are indistinguishable and one of them has to be wrong.
 */
export function wasAcceptedBy(invitation: Invitation, actorId: string): boolean {
  return invitation.status === INVITATION_STATUS.accepted && invitation.acceptedById === actorId;
}

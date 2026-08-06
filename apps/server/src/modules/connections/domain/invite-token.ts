import { nodeCryptoRandomToken } from '../infrastructure/node-crypto-random-token';

/**
 * Cryptographically secure random bytes, base64url-encoded.
 *
 * A port, declared here and implemented in `infrastructure/` (addendum §2: the domain
 * defines the interface, infrastructure implements it). The encoding is part of the
 * contract rather than an adapter detail because the token's *charset* is a domain
 * rule — M2-AC17 asserts it — while `Buffer` and `node:crypto` are not things a
 * domain file may know about.
 *
 * @param byteLength - How many bytes of entropy to draw. Callers pass
 *   {@link INVITE_TOKEN_ENTROPY_BYTES}; an implementation must draw exactly that many
 *   from a CSPRNG and must never stretch a shorter seed to fill it.
 */
export type RandomTokenSource = (byteLength: number) => string;

/**
 * Entropy per invite token.
 *
 * M2-AC17's floor is 16 bytes. This is 32, because the token is a **bearer
 * credential with no rate limit in front of it** — anyone holding it becomes a
 * connection — and doubling it costs eleven characters of URL.
 */
export const INVITE_TOKEN_ENTROPY_BYTES = 32;

/**
 * The person an invite is generated for.
 *
 * Taken by {@link generateInviteToken} and deliberately never read. See that
 * function's note.
 */
export interface InviteTokenSubject {
  /** `app.users.id`. */
  readonly id: string;
  /** The inviter's handle, when the caller happens to have it. */
  readonly handle?: string;
}

/**
 * Mint an opaque invite token.
 *
 * **The subject is accepted and then ignored, by construction.** That is the whole
 * design: a token derived from the inviter's ID or handle — hashed, encoded, salted,
 * any of it — turns the invite link into a disclosure of who sent it, in a product
 * whose PDF §4 promises there is no people search. Taking the parameter and never
 * reading it is what makes the guarantee visible at the call site instead of being an
 * absence a reviewer has to notice; M2-AC17 asserts it directly, both ways round.
 *
 * @param _subject - The inviter. Unused, on purpose.
 * @param randomToken - The CSPRNG port. Defaults to this module's Node adapter, which
 *   is the one edge from `domain/` to `infrastructure/` here: the generator has to be
 *   callable as a plain function (it has no lifecycle and no state), and threading a
 *   source through every caller would buy nothing but ceremony. A test that needs a
 *   deterministic token passes its own.
 * @returns A base64url string of at least 43 characters, unguessable and unlinkable.
 */
export function generateInviteToken(
  _subject: InviteTokenSubject,
  randomToken: RandomTokenSource = nodeCryptoRandomToken,
): string {
  return randomToken(INVITE_TOKEN_ENTROPY_BYTES);
}

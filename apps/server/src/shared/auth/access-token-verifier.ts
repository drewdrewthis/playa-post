import type { AuthenticatedPrincipal } from './actor';

/**
 * Raised when a presented access token is not one this server will act on.
 *
 * **One error for every failure**: bad signature, expired, wrong algorithm, wrong
 * audience, a `service_role` key presented as a user token, a missing `sub`. The
 * caller is told "no", never which check said so. Distinguishing them would hand an
 * attacker a free oracle for probing the verifier, and ADR-0002 §10's
 * indistinguishability rule is the house style for exactly this reason.
 *
 * The specific cause travels in `cause` for the server's own logs, which never leave
 * the trust boundary.
 */
export class AccessTokenVerificationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AccessTokenVerificationError';
  }
}

/**
 * Turns a bearer token into a verified auth identity, or refuses.
 *
 * The port, deliberately: `domain/` and `application/` may depend on this interface,
 * while the thing that knows about JWTs, signing algorithms, and clock skew is an
 * adapter in `shared/auth/` that composition wires in (addendum §2, ADR-0011).
 *
 * Implementations must be safe to share across requests and must not cache a
 * verification result — a token's validity is a function of the clock.
 */
export interface AccessTokenVerifier {
  /**
   * @param token - The raw bearer token, already stripped of its `Bearer ` prefix.
   * @throws {AccessTokenVerificationError} for every rejection, with no detail the
   *   caller could use to distinguish one from another.
   */
  verify(token: string): Promise<AuthenticatedPrincipal>;
}

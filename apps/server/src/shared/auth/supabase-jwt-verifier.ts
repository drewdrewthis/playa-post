import { jwtVerify } from 'jose';

import { AccessTokenVerificationError, type AccessTokenVerifier } from './access-token-verifier';
import type { AuthenticatedPrincipal } from './actor';

/**
 * The `aud` claim Supabase puts on an end-user access token.
 *
 * Asserted rather than ignored because the project's JWT secret signs *every* token
 * the project issues — a token with a different audience is a different kind of
 * credential and must not be accepted as a session.
 */
const SUPABASE_USER_AUDIENCE = 'authenticated';

/**
 * The `role` claim an end-user access token carries.
 *
 * **This check is load-bearing, not decoration.** The Supabase `anon` and
 * `service_role` API keys are JWTs signed with the *same* HS256 secret. Verify only
 * the signature and either one authenticates — and `service_role` is the credential
 * ADR-0002 §2 says must never reach this system at all. Requiring
 * `role === 'authenticated'` **and** a non-empty `sub` rejects both: neither carries
 * a subject, because neither represents a person.
 */
const SUPABASE_USER_ROLE = 'authenticated';

/** Everything {@link createSupabaseJwtVerifier} needs. No environment reads here — only `composition/` may. */
export interface SupabaseJwtVerifierOptions {
  /**
   * The project's HS256 JWT secret, used to **verify** and never to sign.
   *
   * Held as the raw string rather than a pre-imported key so the caller passes
   * configuration, not a crypto object (addendum §12).
   */
  readonly jwtSecret: string;
  /**
   * Seconds of clock skew tolerated on `exp` / `iat`. Defaults to 0.
   *
   * Kept at zero deliberately: Render and Supabase both run NTP-synced clocks, and a
   * tolerance is a window in which a revoked session still works. Widen it only with
   * evidence of real skew.
   */
  readonly clockToleranceSeconds?: number | undefined;
}

function readStringClaim(payload: Readonly<Record<string, unknown>>, claim: string): string | undefined {
  const value = payload[claim];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Verify Supabase-issued end-user access tokens against the project's HS256 secret.
 *
 * The infrastructure adapter behind {@link AccessTokenVerifier} (ADR-0011). It is the
 * one place in the server that knows a token is a JWT at all; everything downstream
 * sees an {@link AuthenticatedPrincipal} or an error.
 *
 * Four assertions, each closing a real hole rather than restating the last:
 *
 * 1. **`algorithms: ['HS256']`** — pinned, so a token whose header says `none` or
 *    `RS256` is rejected before any key is consulted. Algorithm confusion is the
 *    classic JWT break and it is only unreachable when the accepted set is explicit.
 * 2. **`audience`** — see {@link SUPABASE_USER_AUDIENCE}.
 * 3. **`requiredClaims: ['sub', 'exp']`** — a token with no expiry is a permanent
 *    credential; a token with no subject is not a person. `jose` enforces `exp` once
 *    it is required, so there is no separate expiry check to forget.
 * 4. **`role`** — see {@link SUPABASE_USER_ROLE}. This is the one an
 *    otherwise-correct implementation omits.
 *
 * Verification is local: no network call, no JWKS fetch, no Supabase client. That is
 * why the auth boundary adds no latency and no third-party availability dependency to
 * every request — see ADR-0011's alternatives for why asymmetric JWKS is the
 * documented migration rather than the starting point.
 *
 * @example
 * ```ts
 * const verifier = createSupabaseJwtVerifier({ jwtSecret: configuration.supabaseJwtSecret });
 * const principal = await verifier.verify(token); // -> { authUserId }
 * ```
 */
export function createSupabaseJwtVerifier(options: SupabaseJwtVerifierOptions): AccessTokenVerifier {
  // Encoded once at construction: this runs on every authenticated request, and the
  // key material is immutable for the process's lifetime.
  const key = new TextEncoder().encode(options.jwtSecret);

  return {
    async verify(token: string): Promise<AuthenticatedPrincipal> {
      let payload: Readonly<Record<string, unknown>>;

      try {
        ({ payload } = await jwtVerify(token, key, {
          algorithms: ['HS256'],
          audience: SUPABASE_USER_AUDIENCE,
          requiredClaims: ['sub', 'exp'],
          clockTolerance: options.clockToleranceSeconds ?? 0,
        }));
      } catch (cause) {
        throw new AccessTokenVerificationError('Access token rejected.', { cause });
      }

      if (readStringClaim(payload, 'role') !== SUPABASE_USER_ROLE) {
        throw new AccessTokenVerificationError('Access token rejected.');
      }

      const authUserId = readStringClaim(payload, 'sub');
      if (authUserId === undefined) {
        throw new AccessTokenVerificationError('Access token rejected.');
      }

      return { authUserId };
    },
  };
}

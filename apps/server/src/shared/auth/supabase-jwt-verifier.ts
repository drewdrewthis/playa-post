import { jwtVerify, type CryptoKey, type JWTVerifyGetKey } from 'jose';

import { AccessTokenVerificationError, type AccessTokenVerifier } from './access-token-verifier';
import type { AuthenticatedPrincipal } from './actor';

/**
 * The only signature algorithm this server accepts.
 *
 * The Supabase project signs end-user access tokens with an asymmetric signing key and
 * publishes the public half at its JWKS endpoint (ADR-0011). Pinning the algorithm is
 * what makes algorithm confusion unreachable — a token re-headered `alg: none`, `RS256`,
 * or `HS256` is refused before any key is consulted.
 *
 * That ordering is load-bearing, not incidental: `jose` checks this allowlist *before*
 * it calls the key source, so a forged header cannot make this process issue an
 * outbound request to the JWKS endpoint. The verifier's own unit test asserts it.
 *
 * `HS256` in particular is the **retired** arrangement — the project's legacy shared
 * secret. A token still signed with it is not a downgrade path, it is a rejection.
 */
const SUPABASE_SIGNING_ALGORITHM = 'ES256';

/**
 * The `aud` claim Supabase puts on an end-user access token.
 *
 * Asserted rather than ignored because the project's signing key signs *every* token
 * the project issues — a token with a different audience is a different kind of
 * credential and must not be accepted as a session.
 */
const SUPABASE_USER_AUDIENCE = 'authenticated';

/**
 * The `role` claim an end-user access token carries.
 *
 * **This check is load-bearing, not decoration.** A verified signature proves only that
 * the project minted the token, and the project also mints credentials that are not
 * people: `anon` and `service_role`, the latter being the credential ADR-0002 §2 says
 * must never reach this system at all. Requiring `role === 'authenticated'` **and** a
 * non-empty `sub` rejects both — neither carries a subject, because neither is a person.
 *
 * Moving to asymmetric keys did not retire this check. Those keys are HS256-signed with
 * the retired secret *today*, so the algorithm pin already refuses them; but "which
 * credentials the project signs with the live key" is Supabase's decision to change, not
 * ours, and this assertion is the one that does not depend on it.
 */
const SUPABASE_USER_ROLE = 'authenticated';

/**
 * Where {@link createSupabaseJwtVerifier} gets a public key.
 *
 * - A `JWTVerifyGetKey` in production: `createRemoteJWKSet` over the project's JWKS
 *   endpoint, built once in `composition/container.ts`. Resolution matches the token's
 *   `kid` against the published set, which is what makes key rotation a non-event here.
 * - A single public key when there is no key set to consult — what a unit test injects
 *   after `generateKeyPair('ES256')`, so it never touches the network.
 */
export type SupabaseJwtKeySource = CryptoKey | JWTVerifyGetKey;

/** Everything {@link createSupabaseJwtVerifier} needs. No environment reads here — only `composition/` may. */
export interface SupabaseJwtVerifierOptions {
  /**
   * The public key material to verify against. **Injected, never constructed here.**
   *
   * Building the remote key set inside this factory would put a URL, a fetch, and a
   * cache in the one file whose job is claim assertions — and would make every unit
   * test either networked or mocked.
   */
  readonly keySource: SupabaseJwtKeySource;
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
 * Collapse both key-source shapes to the one `jwtVerify` is called with.
 *
 * `jwtVerify` overloads on key-versus-resolver and accepts no union, so the branch has
 * to happen somewhere. Here is the cheapest place: once at construction, rather than on
 * every authenticated request.
 */
function toKeyResolver(keySource: SupabaseJwtKeySource): JWTVerifyGetKey {
  if (typeof keySource === 'function') {
    return keySource;
  }

  // A bare key becomes a resolver that ignores the header — which is precisely what
  // "verify against this one pinned key" means.
  const publicKey: CryptoKey = keySource;
  return () => publicKey;
}

/**
 * Verify Supabase-issued end-user access tokens against the project's published signing
 * keys.
 *
 * The infrastructure adapter behind {@link AccessTokenVerifier} (ADR-0011). It is the
 * one place in the server that knows a token is a JWT at all; everything downstream
 * sees an {@link AuthenticatedPrincipal} or an error.
 *
 * Four assertions, each closing a real hole rather than restating the last:
 *
 * 1. **`algorithms: ['ES256']`** — see {@link SUPABASE_SIGNING_ALGORITHM}. Algorithm
 *    confusion is the classic JWT break and it is only unreachable when the accepted
 *    set is explicit.
 * 2. **`audience`** — see {@link SUPABASE_USER_AUDIENCE}.
 * 3. **`requiredClaims: ['sub', 'exp']`** — a token with no expiry is a permanent
 *    credential; a token with no subject is not a person. `jose` enforces `exp` once
 *    it is required, so there is no separate expiry check to forget.
 * 4. **`role`** — see {@link SUPABASE_USER_ROLE}. This is the one an
 *    otherwise-correct implementation omits.
 *
 * Verification holds **no signing capability**: this process has the public half and
 * nothing else, so compromising it cannot forge a session. What it costs is a
 * dependency on the key source — in production a JWKS fetch, which `jose` caches and
 * rate-limits, so the price is paid on the first token after a cold start or a key
 * rotation, not per request.
 *
 * @example
 * ```ts
 * const verifier = createSupabaseJwtVerifier({
 *   keySource: createRemoteJWKSet(supabaseJwksUrl(configuration.supabaseUrl)),
 * });
 * const principal = await verifier.verify(token); // -> { authUserId }
 * ```
 */
export function createSupabaseJwtVerifier(options: SupabaseJwtVerifierOptions): AccessTokenVerifier {
  const resolveKey = toKeyResolver(options.keySource);

  return {
    async verify(token: string): Promise<AuthenticatedPrincipal> {
      let payload: Readonly<Record<string, unknown>>;

      try {
        ({ payload } = await jwtVerify(token, resolveKey, {
          algorithms: [SUPABASE_SIGNING_ALGORITHM],
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

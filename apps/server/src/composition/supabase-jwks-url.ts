/**
 * Path Supabase Auth serves a project's JSON Web Key Set at.
 *
 * Fixed by the platform, not configurable: GoTrue mounts it under the `/auth/v1` prefix
 * of the project's API URL.
 */
const SUPABASE_JWKS_PATH = '/auth/v1/.well-known/jwks.json';

/**
 * Derive a Supabase project's JWKS endpoint from its base API URL.
 *
 * **One place, deliberately.** This URL decides which project's signing keys are
 * trusted, and every way of getting it wrong fails the same, silent way: the fetch
 * 404s, so every verification throws, and ADR-0011's single uniform error message makes
 * that indistinguishable — by design — from "the token was bad". The symptom is "all
 * logins fail" with nothing pointing at a URL. Scattering the concatenation across call
 * sites would multiply the ways to arrive there.
 *
 * Trailing slashes are stripped before joining. `https://<ref>.supabase.co/` is what an
 * operator copies out of the Supabase dashboard, and naive concatenation turns it into
 * `//auth/v1/...` — a different path, and a 404. Joining with `new URL(path, base)`
 * would fix that but silently discard any base path, so the string is normalised
 * instead.
 *
 * @param supabaseUrl - `Configuration.supabaseUrl`, already validated as a URL.
 * @throws {TypeError} when `supabaseUrl` does not parse. Unreachable through
 *   `loadServerConfiguration`, which rejects that at boot with the key named.
 *
 * @example
 * ```ts
 * supabaseJwksUrl('https://abcdef.supabase.co').href;
 * // 'https://abcdef.supabase.co/auth/v1/.well-known/jwks.json'
 * ```
 */
export function supabaseJwksUrl(supabaseUrl: string): URL {
  return new URL(`${supabaseUrl.replace(/\/+$/, '')}${SUPABASE_JWKS_PATH}`);
}

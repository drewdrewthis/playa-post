import { randomBytes, randomUUID } from 'node:crypto';

import { SignJWT } from 'jose';

/** Claims a Supabase-issued end-user access token carries that a harness needs to set. */
export interface SupabaseUserTokenOptions {
  /** The HS256 signing secret PostgREST is running with. */
  readonly secret: string;
  /**
   * The `role` claim — the Postgres role PostgREST will `SET LOCAL ROLE` to.
   *
   * This claim is the entire authorization decision on the PostgREST side, which is
   * why ADR-0002 §1 does not rely on it: the schema is not exposed at all, so no value
   * here reaches product data.
   */
  readonly role: string;
  /** The `sub` claim. Defaults to a fresh UUID, as a real Supabase user id would be. */
  readonly subject?: string;
}

/**
 * Generate a throwaway HS256 signing secret for a test stack.
 *
 * **Generated per run and never written down.** A test JWT secret checked into the
 * repository is a secret checked into the repository — `secret-scan` would be right to
 * flag it, and addendum §17 forbids it whether or not the value guards anything real.
 * Minting it here also means the harness and the server it configures cannot drift.
 *
 * 32 bytes, hex-encoded: PostgREST rejects a `jwt-secret` shorter than 32 characters,
 * and `jose` rejects an HS256 key shorter than the hash output.
 */
export function generateJwtSigningSecret(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Mint a signed, currently-valid access token shaped like the one Supabase Auth issues.
 *
 * **Why the harness signs this rather than running GoTrue** (ADR-0010): PostgREST
 * verifies an HS256 token against a shared secret and reads the `role` claim. It cannot
 * tell — and has no way to ask — whether GoTrue produced the token. Running an auth
 * server, its schema, and a mail catcher to obtain a string that is verifiable here in
 * four lines would add moving parts to a security control without adding a property it
 * asserts. What *does* need proving is that the token is genuinely accepted, and that is
 * proven behaviourally: the B2 suite reads an exposed table with this token before it
 * asserts anything about a denial, so a rejected token cannot masquerade as a denial.
 *
 * @example
 * ```ts
 * const token = await mintSupabaseUserToken({ secret, role: 'authenticated' });
 * await fetch(`${baseUrl}/bulletins`, { headers: { authorization: `Bearer ${token}` } });
 * ```
 */
export async function mintSupabaseUserToken({
  secret,
  role,
  subject = randomUUID(),
}: SupabaseUserTokenOptions): Promise<string> {
  return new SignJWT({ role, aud: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(secret));
}

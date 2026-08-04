import { randomUUID } from 'node:crypto';

import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type CryptoKey,
  type JWK,
  type JWTVerifyGetKey,
} from 'jose';

/**
 * The algorithm Supabase's asymmetric signing keys use, and the only one the server
 * accepts (ADR-0011).
 *
 * Pinned here so a token this helper mints is one the verifier could accept. A helper
 * that minted RS256 would turn every acceptance test red for a reason that has nothing
 * to do with the code under test.
 */
const SUPABASE_SIGNING_ALGORITHM = 'ES256';

/** A stand-in for one of a Supabase project's published signing keys. */
export interface SupabaseSigningKeyPair {
  /** The `kid` this key signs with and publishes under. */
  readonly keyId: string;
  /** Signs tokens. A real project keeps this half and never publishes it. */
  readonly privateKey: CryptoKey;
  /** Verifies tokens. Injected directly when a test needs no key *set*. */
  readonly publicKey: CryptoKey;
  /** The public half as a JWK, `kid` included — the shape the project's JWKS serves. */
  readonly publicJwk: JWK;
}

/**
 * Generate a throwaway ES256 signing key pair for a test.
 *
 * **Generated per run and never written down.** A checked-in private key is a
 * checked-in credential whether or not it guards anything real (addendum §17), and
 * `secret-scan` would be right to flag one.
 *
 * @param keyId - The `kid` to sign and publish under. Defaults to a fresh UUID; pass a
 *   fixed one when a test's readability depends on the header being predictable.
 */
export async function generateSupabaseSigningKeyPair(
  keyId: string = randomUUID(),
): Promise<SupabaseSigningKeyPair> {
  const { privateKey, publicKey } = await generateKeyPair(SUPABASE_SIGNING_ALGORITHM);
  const publicJwk: JWK = {
    ...(await exportJWK(publicKey)),
    kid: keyId,
    alg: SUPABASE_SIGNING_ALGORITHM,
    use: 'sig',
  };

  return { keyId, privateKey, publicKey, publicJwk };
}

/**
 * Build the key source the server uses in production, minus the HTTP fetch.
 *
 * `createRemoteJWKSet` and `createLocalJWKSet` resolve keys the same way — match the
 * JWS header's `kid` against a published set, refuse when nothing matches. Injecting
 * the local one means a unit test exercises the real resolution path, including the
 * unknown-`kid` rejection, without a network round trip or a stubbed `fetch`.
 *
 * @param keyPairs - Every key to publish. Pass more than one to model a rotation in
 *   progress, where the old and new keys are both live.
 *
 * @example
 * ```ts
 * const verifier = createSupabaseJwtVerifier({ keySource: createSupabaseJwksKeySource(key) });
 * ```
 */
export function createSupabaseJwksKeySource(
  ...keyPairs: readonly SupabaseSigningKeyPair[]
): JWTVerifyGetKey {
  return createLocalJWKSet({ keys: keyPairs.map((keyPair) => keyPair.publicJwk) });
}

/** Claims and key a Supabase-shaped, asymmetrically-signed access token needs. */
export interface SupabaseAsymmetricUserTokenOptions {
  /** The project key to sign with. Its `keyId` lands in the token's `kid` header. */
  readonly signingKey: SupabaseSigningKeyPair;
  /**
   * The `role` claim.
   *
   * `'authenticated'` is the only value the server accepts (ADR-0011); the others exist
   * so a test can present the credentials a real project also signs.
   */
  readonly role: string;
  /** The `sub` claim. Defaults to a fresh UUID, as a real Supabase user id would be. */
  readonly subject?: string;
}

/**
 * Mint a currently-valid access token shaped the way Supabase Auth issues them under
 * asymmetric signing keys.
 *
 * The counterpart to `mintSupabaseUserToken`, which signs HS256 for the PostgREST
 * harness (ADR-0010). The two are deliberately separate: PostgREST verifies against a
 * shared secret it is configured with, while the application server verifies against a
 * published key set (ADR-0011). One helper covering both would have to be told which
 * arrangement it is imitating on every call.
 *
 * @example
 * ```ts
 * const token = await mintSupabaseAsymmetricUserToken({ signingKey, role: 'authenticated' });
 * ```
 */
export async function mintSupabaseAsymmetricUserToken({
  signingKey,
  role,
  subject = randomUUID(),
}: SupabaseAsymmetricUserTokenOptions): Promise<string> {
  return new SignJWT({ role, aud: 'authenticated' })
    .setProtectedHeader({ alg: SUPABASE_SIGNING_ALGORITHM, typ: 'JWT', kid: signingKey.keyId })
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(signingKey.privateKey);
}

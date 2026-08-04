import { SignJWT } from 'jose';
import { describe, expect, it, vi } from 'vitest';

import {
  createSupabaseJwksKeySource,
  generateJwtSigningSecret,
  generateSupabaseSigningKeyPair,
  mintSupabaseAsymmetricUserToken,
  mintSupabaseUserToken,
  type SupabaseSigningKeyPair,
} from '@playa-post/testing';

import { AccessTokenVerificationError } from './access-token-verifier';
import { createSupabaseJwtVerifier } from './supabase-jwt-verifier';

/**
 * The project's signing key, generated per run and never written down — a checked-in
 * private key is a checked-in credential whether or not it guards anything real
 * (addendum §17, and `secret-scan` would be right to flag it).
 */
const projectKey = await generateSupabaseSigningKeyPair('project-key-1');
const otherProjectKey = await generateSupabaseSigningKeyPair('other-project-key');

/**
 * The production shape: a JWKS resolver that matches the token's `kid` against a
 * published set and refuses when nothing matches. Local rather than remote, so these
 * tests exercise the real resolution path — including the unknown-`kid` rejection —
 * with no network and no stubbed `fetch` (ADR-0011).
 */
const verifier = createSupabaseJwtVerifier({ keySource: createSupabaseJwksKeySource(projectKey) });

/** Sign a token with arbitrary claims, so a test can build the shapes Supabase would not. */
async function signToken(
  claims: Record<string, unknown>,
  {
    signingKey = projectKey,
    keyId = projectKey.keyId,
    expiresIn = '1h',
  }: {
    signingKey?: SupabaseSigningKeyPair;
    keyId?: string;
    expiresIn?: string | number;
  } = {},
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'ES256', typ: 'JWT', kid: keyId })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(signingKey.privateKey);
}

function base64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

describe('createSupabaseJwtVerifier', () => {
  describe('accepts', () => {
    it('a token shaped the way Supabase Auth issues them, returning its subject', async () => {
      // Minted by the same helper the request-scope and HTTP suites use, so a drift
      // between what tests mint and what this verifier accepts fails here rather than
      // three layers up.
      const token = await mintSupabaseAsymmetricUserToken({
        signingKey: projectKey,
        role: 'authenticated',
      });

      const principal = await verifier.verify(token);

      expect(principal.authUserId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('the auth user id from `sub`, not from any other claim', async () => {
      const authUserId = '5d1f6c2a-0000-4000-8000-000000000001';
      const token = await mintSupabaseAsymmetricUserToken({
        signingKey: projectKey,
        role: 'authenticated',
        subject: authUserId,
      });

      await expect(verifier.verify(token)).resolves.toEqual({ authUserId });
    });

    it('a single pinned public key as its key source, with no key set to consult', async () => {
      // The other arm of `SupabaseJwtKeySource`, and the one the request-scope and
      // HTTP suites inject: same assertions, no `kid` matching.
      const pinned = createSupabaseJwtVerifier({ keySource: projectKey.publicKey });
      const token = await mintSupabaseAsymmetricUserToken({
        signingKey: projectKey,
        role: 'authenticated',
        subject: 'auth-user-1',
      });

      await expect(pinned.verify(token)).resolves.toEqual({ authUserId: 'auth-user-1' });
    });
  });

  describe('rejects', () => {
    it('a token whose `kid` matches no published key', async () => {
      const token = await mintSupabaseAsymmetricUserToken({
        signingKey: otherProjectKey,
        role: 'authenticated',
      });

      await expect(verifier.verify(token)).rejects.toThrow(AccessTokenVerificationError);
    });

    it('a token signed by another key while wearing this project’s `kid`', async () => {
      // Distinct from the case above: the key set resolves a key here, and the
      // signature check is what refuses. Without this, "unknown kid" alone could be
      // passing for signature verification.
      const token = await signToken(
        { role: 'authenticated', aud: 'authenticated', sub: 'user-1' },
        { signingKey: otherProjectKey, keyId: projectKey.keyId },
      );

      await expect(verifier.verify(token)).rejects.toThrow(AccessTokenVerificationError);
    });

    it('a token whose signature has been tampered with', async () => {
      const token = await mintSupabaseAsymmetricUserToken({
        signingKey: projectKey,
        role: 'authenticated',
      });
      const [header, payload, signature] = token.split('.');
      // Tamper the FIRST char: the base64url final char of a 64-byte ES256
      // signature carries only 2 significant bits plus 4 padding bits, so a
      // last-char flip (e.g. A->B) can decode to identical bytes and verify.
      const flipped = `${signature?.startsWith('A') === true ? 'B' : 'A'}${signature?.slice(1) ?? ''}`;

      await expect(verifier.verify(`${header}.${payload}.${flipped}`)).rejects.toThrow(
        AccessTokenVerificationError,
      );
    });

    it('a token whose payload has been tampered with, even by one claim', async () => {
      const token = await mintSupabaseAsymmetricUserToken({
        signingKey: projectKey,
        role: 'authenticated',
      });
      const [header, , signature] = token.split('.');
      const forged = base64url({
        sub: 'someone-else',
        role: 'authenticated',
        aud: 'authenticated',
        exp: Math.floor(Date.now() / 1000) + 3600,
      });

      await expect(verifier.verify(`${header}.${forged}.${signature}`)).rejects.toThrow(
        AccessTokenVerificationError,
      );
    });

    it('an expired token', async () => {
      const token = await signToken(
        { role: 'authenticated', aud: 'authenticated', sub: 'expired-user' },
        { expiresIn: Math.floor(Date.now() / 1000) - 60 },
      );

      await expect(verifier.verify(token)).rejects.toThrow(AccessTokenVerificationError);
    });

    it('a token with no expiry — a credential that never dies is not a session', async () => {
      const unexpiring = await new SignJWT({
        role: 'authenticated',
        aud: 'authenticated',
        sub: 'forever-user',
      })
        .setProtectedHeader({ alg: 'ES256', typ: 'JWT', kid: projectKey.keyId })
        .setIssuedAt()
        .sign(projectKey.privateKey);

      await expect(verifier.verify(unexpiring)).rejects.toThrow(AccessTokenVerificationError);
    });

    // The one an otherwise-correct implementation misses. A verified signature proves
    // only that the project minted the token, and the project also mints credentials
    // that are not people — `service_role` being the one ADR-0002 §2 says must never
    // reach this system. Signed with the project's own live key, correct audience,
    // *and* a subject, so every other assertion passes and only `role` can be doing the
    // rejecting. (A real service_role credential carries no `sub`; giving it one here is
    // what makes the test isolate the check instead of riding on `requiredClaims`.)
    it('a service_role token signed by the project’s own live key', async () => {
      const token = await signToken({ role: 'service_role', aud: 'authenticated', sub: 'user-1' });

      await expect(verifier.verify(token)).rejects.toThrow(AccessTokenVerificationError);
    });

    it('an anon token, for the same reason', async () => {
      const token = await signToken({ role: 'anon', aud: 'authenticated', sub: 'user-1' });

      await expect(verifier.verify(token)).rejects.toThrow(AccessTokenVerificationError);
    });

    it('a token with the right role but no subject — nobody to be', async () => {
      const token = await signToken({ role: 'authenticated', aud: 'authenticated' });

      await expect(verifier.verify(token)).rejects.toThrow(AccessTokenVerificationError);
    });

    it('a token whose subject is the empty string, which `requiredClaims` alone would admit', async () => {
      // `requiredClaims` checks presence, not content. Without the verifier's own
      // non-empty check this token would resolve to a principal with an empty
      // `authUserId` — an actor lookup for nobody, and the reason that check exists.
      const token = await signToken({ role: 'authenticated', aud: 'authenticated', sub: '' });

      await expect(verifier.verify(token)).rejects.toThrow(AccessTokenVerificationError);
    });

    it('a token issued for another audience', async () => {
      const token = await signToken({ role: 'authenticated', aud: 'admin', sub: 'user-1' });

      await expect(verifier.verify(token)).rejects.toThrow(AccessTokenVerificationError);
    });

    it('a string that is not a token at all', async () => {
      await expect(verifier.verify('not-a-jwt')).rejects.toThrow(AccessTokenVerificationError);
    });
  });

  // Algorithm confusion, and the reason `algorithms` is pinned rather than inferred.
  // `HS256` is the *retired* arrangement — the project's legacy shared secret — so this
  // is also the regression test for the migration: a token signed the old way is
  // refused, not quietly still accepted.
  //
  // The `not.toHaveBeenCalled()` is the load-bearing half. `jose` checks the algorithm
  // allowlist before it resolves a key, which means a forged header cannot make this
  // process reach out to the JWKS endpoint. Lose that ordering and an unauthenticated
  // caller has an outbound-request amplifier.
  it('refuses HS256 and `alg: none` without ever consulting the key source', async () => {
    // `: never` is not decoration — it makes the mock's type unambiguously satisfy
    // `SupabaseJwtKeySource`, so this test fails by assertion rather than by inference.
    const keySource = vi.fn((): never => {
      throw new Error('the key source must not be consulted for a disallowed algorithm');
    });
    const pinned = createSupabaseJwtVerifier({ keySource });

    const hs256 = await mintSupabaseUserToken({
      secret: generateJwtSigningSecret(),
      role: 'authenticated',
    });
    const unsigned = `${base64url({ alg: 'none', typ: 'JWT' })}.${base64url({
      role: 'authenticated',
      aud: 'authenticated',
      sub: 'user-1',
      exp: Math.floor(Date.now() / 1000) + 3600,
    })}.`;

    await expect(pinned.verify(hs256)).rejects.toThrow(AccessTokenVerificationError);
    await expect(pinned.verify(unsigned)).rejects.toThrow(AccessTokenVerificationError);
    expect(keySource).not.toHaveBeenCalled();
  });

  // ADR-0002 §10 as house style: a caller learns "no", never which check said so.
  // Distinguishable messages would let an attacker binary-search the verifier — and the
  // unknown-`kid` path is the one that matters most here, because a distinguishable
  // answer to "is this key id published?" is a free enumeration oracle.
  it('says the same thing however verification failed', async () => {
    const expired = await signToken(
      { role: 'authenticated', aud: 'authenticated', sub: 'u' },
      { expiresIn: Math.floor(Date.now() / 1000) - 60 },
    );
    // With a `sub`, so this really is the role check answering — and the role check is
    // the one rejection built without a `cause`, i.e. the one most likely to drift.
    const wrongRole = await signToken({ role: 'service_role', aud: 'authenticated', sub: 'u' });
    const wrongKey = await signToken(
      { role: 'authenticated', aud: 'authenticated', sub: 'u' },
      { signingKey: otherProjectKey, keyId: projectKey.keyId },
    );
    const unknownKid = await signToken(
      { role: 'authenticated', aud: 'authenticated', sub: 'u' },
      { keyId: 'a-key-id-that-was-never-published' },
    );

    const messages = await Promise.all(
      [expired, wrongRole, wrongKey, unknownKid, 'not-a-jwt'].map(async (token) => {
        try {
          await verifier.verify(token);
          return 'unexpectedly accepted';
        } catch (error) {
          return (error as Error).message;
        }
      }),
    );

    expect(new Set(messages).size).toBe(1);
  });
});

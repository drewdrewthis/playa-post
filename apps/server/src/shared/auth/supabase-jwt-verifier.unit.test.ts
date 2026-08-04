import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';

import { generateJwtSigningSecret, mintSupabaseUserToken } from '@playa-post/testing';

import { AccessTokenVerificationError } from './access-token-verifier';
import { createSupabaseJwtVerifier } from './supabase-jwt-verifier';

/**
 * The project secret, generated per run and never written down — a fixed test JWT
 * secret in the repository is a secret in the repository, whether or not it guards
 * anything real (addendum §17, and `secret-scan` would be right to flag it).
 */
const jwtSecret = generateJwtSigningSecret();
const otherProjectSecret = generateJwtSigningSecret();

const verifier = createSupabaseJwtVerifier({ jwtSecret });

/** Sign a token with arbitrary claims, so a test can build the shapes Supabase would not. */
async function signToken(
  claims: Record<string, unknown>,
  { secret = jwtSecret, expiresIn = '1h' }: { secret?: string; expiresIn?: string | number } = {},
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(new TextEncoder().encode(secret));
}

function base64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

describe('createSupabaseJwtVerifier', () => {
  describe('accepts', () => {
    it('a token shaped the way Supabase Auth issues them, returning its subject', async () => {
      // Minted by the same helper the security harness uses (ADR-0010), so a drift
      // between what tests mint and what this verifier accepts fails here rather than
      // in L1's integration suite.
      const token = await mintSupabaseUserToken({ secret: jwtSecret, role: 'authenticated' });

      const principal = await verifier.verify(token);

      expect(principal.authUserId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('the auth user id from `sub`, not from any other claim', async () => {
      const authUserId = '5d1f6c2a-0000-4000-8000-000000000001';
      const token = await mintSupabaseUserToken({
        secret: jwtSecret,
        role: 'authenticated',
        subject: authUserId,
      });

      await expect(verifier.verify(token)).resolves.toEqual({ authUserId });
    });
  });

  describe('rejects', () => {
    it('a token signed with another project’s secret', async () => {
      const token = await mintSupabaseUserToken({
        secret: otherProjectSecret,
        role: 'authenticated',
      });

      await expect(verifier.verify(token)).rejects.toThrow(AccessTokenVerificationError);
    });

    it('a token whose signature has been tampered with', async () => {
      const token = await mintSupabaseUserToken({ secret: jwtSecret, role: 'authenticated' });
      const [header, payload, signature] = token.split('.');
      const flipped = `${signature?.slice(0, -1) ?? ''}${signature?.endsWith('A') === true ? 'B' : 'A'}`;

      await expect(verifier.verify(`${header}.${payload}.${flipped}`)).rejects.toThrow(
        AccessTokenVerificationError,
      );
    });

    it('a token whose payload has been tampered with, even by one claim', async () => {
      const token = await mintSupabaseUserToken({ secret: jwtSecret, role: 'authenticated' });
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
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setIssuedAt()
        .sign(new TextEncoder().encode(jwtSecret));

      await expect(verifier.verify(unexpiring)).rejects.toThrow(AccessTokenVerificationError);
    });

    // The one an otherwise-correct implementation misses. Supabase signs the
    // `service_role` and `anon` API keys with the SAME secret as user tokens, so a
    // verifier that checks only the signature accepts the credential ADR-0002 §2 says
    // must never reach this system — as a user.
    it('the service_role key, though it is signed with the very same secret', async () => {
      const token = await signToken({ role: 'service_role', aud: 'authenticated' });

      await expect(verifier.verify(token)).rejects.toThrow(AccessTokenVerificationError);
    });

    it('the anon key, for the same reason', async () => {
      const token = await mintSupabaseUserToken({ secret: jwtSecret, role: 'anon' });

      await expect(verifier.verify(token)).rejects.toThrow(AccessTokenVerificationError);
    });

    it('a token with the right role but no subject — nobody to be', async () => {
      const token = await signToken({ role: 'authenticated', aud: 'authenticated' });

      await expect(verifier.verify(token)).rejects.toThrow(AccessTokenVerificationError);
    });

    it('a token issued for another audience', async () => {
      const token = await signToken({ role: 'authenticated', aud: 'admin', sub: 'user-1' });

      await expect(verifier.verify(token)).rejects.toThrow(AccessTokenVerificationError);
    });

    // Algorithm confusion: an attacker re-headers a token as unsigned and drops the
    // signature. Only an explicit `algorithms` allowlist makes this unreachable.
    it('an unsigned token claiming `alg: none`', async () => {
      const unsigned = `${base64url({ alg: 'none', typ: 'JWT' })}.${base64url({
        role: 'authenticated',
        aud: 'authenticated',
        sub: 'user-1',
        exp: Math.floor(Date.now() / 1000) + 3600,
      })}.`;

      await expect(verifier.verify(unsigned)).rejects.toThrow(AccessTokenVerificationError);
    });

    it('a string that is not a token at all', async () => {
      await expect(verifier.verify('not-a-jwt')).rejects.toThrow(AccessTokenVerificationError);
    });
  });

  // ADR-0002 §10 as house style: a caller learns "no", never which check said so.
  // Distinguishable messages would let an attacker binary-search the verifier.
  it('says the same thing however verification failed', async () => {
    const expired = await signToken(
      { role: 'authenticated', aud: 'authenticated', sub: 'u' },
      { expiresIn: Math.floor(Date.now() / 1000) - 60 },
    );
    const wrongRole = await signToken({ role: 'service_role', aud: 'authenticated' });
    const wrongSecret = await signToken(
      { role: 'authenticated', aud: 'authenticated', sub: 'u' },
      { secret: otherProjectSecret },
    );

    const messages = await Promise.all(
      [expired, wrongRole, wrongSecret, 'not-a-jwt'].map(async (token) => {
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

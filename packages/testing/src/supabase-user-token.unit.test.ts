import { jwtVerify } from 'jose';
import { describe, expect, it } from 'vitest';

import { generateJwtSigningSecret, mintSupabaseUserToken } from './supabase-user-token';

/**
 * The token minter the ADR-0002 B2 harness presents to PostgREST.
 *
 * B2's assertion is worth nothing unless the token really is "a valid user JWT" — a
 * rejected token produces a denial too, and a denial for the wrong reason is a control
 * that has stopped working silently. The security suite proves acceptance end-to-end by
 * reading an exposed table first; these cases pin the claim shape without a container, so
 * a break in the minter is visible in `test:unit` rather than only in the slow job.
 */
describe('Supabase user token minter', () => {
  const secret = generateJwtSigningSecret();
  const key = new TextEncoder().encode(secret);

  it('mints an HS256 token that verifies under the signing secret', async () => {
    const token = await mintSupabaseUserToken({ secret, role: 'authenticated' });
    const { protectedHeader } = await jwtVerify(token, key);

    expect(protectedHeader.alg).toBe('HS256');
  });

  it('carries the role claim PostgREST switches on, and a subject', async () => {
    const token = await mintSupabaseUserToken({
      secret,
      role: 'service_role',
      subject: '00000000-0000-4000-8000-00000000beef',
    });
    const { payload } = await jwtVerify(token, key);

    expect(payload.role).toBe('service_role');
    expect(payload.sub).toBe('00000000-0000-4000-8000-00000000beef');
  });

  it('is currently valid, not expired on arrival', async () => {
    const { payload } = await jwtVerify(
      await mintSupabaseUserToken({ secret, role: 'authenticated' }),
      key,
    );
    const now = Math.floor(Date.now() / 1000);

    expect(payload.iat).toBeLessThanOrEqual(now);
    expect(payload.exp).toBeGreaterThan(now);
  });

  it('does not verify under a different secret', async () => {
    // The negative half of the security suite's credibility control, asserted here too
    // because it is what makes the positive control mean anything: if any string
    // verified, "the token was accepted" would carry no information.
    await expect(
      jwtVerify(
        await mintSupabaseUserToken({ secret, role: 'authenticated' }),
        new TextEncoder().encode(generateJwtSigningSecret()),
      ),
    ).rejects.toThrow();
  });

  it('generates a fresh secret long enough for HS256 and for PostgREST', () => {
    // PostgREST rejects a `jwt-secret` under 32 characters; a per-run value is what
    // keeps this repository free of a checked-in test secret (addendum §17).
    expect(generateJwtSigningSecret()).not.toBe(generateJwtSigningSecret());
    expect(generateJwtSigningSecret().length).toBeGreaterThanOrEqual(32);
  });
});

import { jwtVerify } from 'jose';
import { describe, expect, it } from 'vitest';

import {
  createSupabaseJwksKeySource,
  generateSupabaseSigningKeyPair,
  mintSupabaseAsymmetricUserToken,
} from './supabase-asymmetric-token';

const projectKey = await generateSupabaseSigningKeyPair('project-key-1');
const otherProjectKey = await generateSupabaseSigningKeyPair('other-project-key');
const keySource = createSupabaseJwksKeySource(projectKey);

/**
 * The key material and minter every server-side auth test injects (ADR-0011).
 *
 * Those tests assert what the *verifier* accepts. That assertion is worth nothing
 * unless this helper really produces a Supabase-shaped, ES256-signed token — a minter
 * that quietly emitted RS256, or omitted `kid`, would make the verifier's acceptance
 * tests fail for a reason nowhere near the verifier. Pinning the shape here means the
 * break is visible at its source.
 */
describe('Supabase asymmetric token minter', () => {
  it('mints an ES256 token that verifies through the published key set', async () => {
    const token = await mintSupabaseAsymmetricUserToken({
      signingKey: projectKey,
      role: 'authenticated',
    });

    const { protectedHeader } = await jwtVerify(token, keySource);

    expect(protectedHeader.alg).toBe('ES256');
    expect(protectedHeader.kid).toBe('project-key-1');
  });

  it('carries the claims a user session is recognised by', async () => {
    const token = await mintSupabaseAsymmetricUserToken({
      signingKey: projectKey,
      role: 'authenticated',
      subject: '00000000-0000-4000-8000-00000000beef',
    });

    const { payload } = await jwtVerify(token, keySource);

    expect(payload.role).toBe('authenticated');
    expect(payload.aud).toBe('authenticated');
    expect(payload.sub).toBe('00000000-0000-4000-8000-00000000beef');
  });

  it('is currently valid, not expired on arrival', async () => {
    const { payload } = await jwtVerify(
      await mintSupabaseAsymmetricUserToken({ signingKey: projectKey, role: 'authenticated' }),
      keySource,
    );
    const now = Math.floor(Date.now() / 1000);

    expect(payload.iat).toBeLessThanOrEqual(now);
    expect(payload.exp).toBeGreaterThan(now);
  });

  it('does not verify through another project’s key set', async () => {
    // The negative half of the control: if any token verified, "the verifier accepted
    // it" would carry no information.
    await expect(
      jwtVerify(
        await mintSupabaseAsymmetricUserToken({ signingKey: otherProjectKey, role: 'authenticated' }),
        keySource,
      ),
    ).rejects.toThrow();
  });

  it('publishes only public key material — a private JWK here would be a leaked key', () => {
    // `d` is the EC private scalar. Its presence in the published set would mean the
    // "public" key source hands out something that can mint tokens.
    expect(projectKey.publicJwk.d).toBeUndefined();
    expect(projectKey.publicJwk.kid).toBe('project-key-1');
  });

  it('generates a distinct key pair per call', async () => {
    const [first, second] = await Promise.all([
      generateSupabaseSigningKeyPair(),
      generateSupabaseSigningKeyPair(),
    ]);

    expect(first.keyId).not.toBe(second.keyId);
    expect(first.publicJwk.x).not.toBe(second.publicJwk.x);
  });
});

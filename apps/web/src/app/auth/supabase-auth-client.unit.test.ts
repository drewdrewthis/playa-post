import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSupabaseAuthClient } from './supabase-auth-client';

/**
 * `@supabase/supabase-js` is a boundary this app does not own — a mock rather than a
 * fake, for the reason `../pwa/register-service-worker.unit.test.ts` gives for
 * `virtual:pwa-register`. `vi.mock` is hoisted above every import by Vitest's transform,
 * so `createSupabaseAuthClient` above already closes over the mocked module; `vi.hoisted`
 * keeps `verifyOtp` one stable instance across the file, so each test's `.mock.calls`
 * history reflects only that test once `afterEach` has cleared it.
 */
const { verifyOtp } = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      verifyOtp,
      signInWithOtp: vi.fn(),
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(),
      signOut: vi.fn(),
    },
  }),
}));

beforeEach(() => {
  // `supabaseClient()` refuses to construct a client at all without both of these —
  // present so the module under test reaches the mocked `createClient` in every case.
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');
});

afterEach(() => {
  vi.unstubAllEnvs();
  verifyOtp.mockReset();
});

/**
 * `verifySignInCode` (issue #179): the PWA-reachable half of sign-in, verifying the
 * one-time code the same email carries as `requestSignInLink`'s magic link. Mirrors
 * `requestSignInLink` in every way that matters here — same error-propagation shape —
 * so only what differs is asserted: the call reaches `verifyOtp` as an email-type OTP,
 * and a rejection is thrown rather than swallowed.
 */
describe('createSupabaseAuthClient().verifySignInCode', () => {
  it('verifies the code against the email as an email-type OTP', async () => {
    verifyOtp.mockResolvedValue({ data: {}, error: null });

    await createSupabaseAuthClient().verifySignInCode('person@example.com', '123456');

    expect(verifyOtp).toHaveBeenCalledWith({
      email: 'person@example.com',
      token: '123456',
      type: 'email',
    });
  });

  it('throws the provider error when the code is rejected', async () => {
    const rejection = Object.assign(new Error('Token has expired or is invalid'), {
      status: 403,
      code: 'otp_expired',
    });
    verifyOtp.mockResolvedValue({ data: {}, error: rejection });

    await expect(
      createSupabaseAuthClient().verifySignInCode('person@example.com', '000000'),
    ).rejects.toBe(rejection);
  });
});

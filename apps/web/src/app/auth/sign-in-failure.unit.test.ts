import { describe, expect, it } from 'vitest';

import { describeSignInFailure } from './sign-in-failure';
import { AuthNotConfiguredError } from './supabase-auth-client';

/**
 * What the sign-in screen says when the link does not go out.
 *
 * The rate-limited case is the one a real user meets: Supabase refuses a second magic
 * link to the same address inside its send window with HTTP 429 and
 * `over_email_send_rate_limit`, and until this module existed that arrived as "That did
 * not go through. Check the address and try again." — advice that is *wrong*, because
 * the address is fine and re-checking it is the one thing that cannot help.
 */
describe('describeSignInFailure', () => {
  const generic = describeSignInFailure(new Error('network died'));

  it('names an unconfigured build, which is not the user’s problem to fix', () => {
    expect(describeSignInFailure(new AuthNotConfiguredError())).toBe(
      'This build has no sign-in service configured yet.',
    );
  });

  it('falls back to the generic refusal for an unrecognised failure', () => {
    expect(generic).toBe('That did not go through. Check the address and try again.');
  });

  it('falls back to the generic refusal for a non-error value', () => {
    expect(describeSignInFailure('nope')).toBe(generic);
    expect(describeSignInFailure(null)).toBe(generic);
    expect(describeSignInFailure(undefined)).toBe(generic);
  });

  describe('rate limited', () => {
    /** Shaped like `AuthApiError`: an `Error` carrying `status` and `code`. */
    function authApiError(status: number, code: string): Error {
      return Object.assign(new Error('email rate limit exceeded'), { status, code });
    }

    it('says to wait rather than to re-check the address', () => {
      const message = describeSignInFailure(authApiError(429, 'over_email_send_rate_limit'));

      expect(message).not.toBe(generic);
      expect(message).toMatch(/wait/i);
    });

    it('never tells a rate-limited user their address is suspect', () => {
      expect(describeSignInFailure(authApiError(429, 'over_email_send_rate_limit'))).not.toMatch(
        /check the address/i,
      );
    });

    it('recognises the HTTP status alone, with no error code', () => {
      expect(describeSignInFailure(Object.assign(new Error('too many requests'), { status: 429 }))).not.toBe(
        generic,
      );
    });

    it.each(['over_email_send_rate_limit', 'over_request_rate_limit', 'over_sms_send_rate_limit'])(
      'recognises %s, with no status attached',
      (code) => {
        expect(describeSignInFailure(Object.assign(new Error('slow down'), { code }))).not.toBe(
          generic,
        );
      },
    );

    /*
     * The provider's raw JSON body is `{"code":429,"error_code":"over_email_send_rate_limit",
     * "msg":"email rate limit exceeded"}` — a *numeric* `code` and the string under
     * `error_code`, which is the opposite of the shape `AuthError` normalises to. Both
     * spellings reach this function depending on whether supabase-js wrapped the
     * response or something rethrew the body.
     */
    it('recognises the provider’s raw envelope, where `code` is the number and `error_code` the string', () => {
      expect(
        describeSignInFailure({
          code: 429,
          error_code: 'over_email_send_rate_limit',
          msg: 'email rate limit exceeded',
        }),
      ).not.toBe(generic);
    });

    it('does not mistake an ordinary refusal for a rate limit', () => {
      expect(describeSignInFailure(authApiError(400, 'validation_failed'))).toBe(generic);
    });
  });

  /**
   * GoTrue answers a wrong digit, an expired code, and an already-spent code with the
   * identical `otp_expired` / HTTP 403 signal — the same lookup fails for all three, and
   * there is nothing on the wire to tell them apart (issue #179). These cases stand in
   * for all three causes; there is deliberately no separate "expired" or "already used"
   * branch to test, because none exists.
   */
  describe('code rejected', () => {
    /** Shaped like `AuthApiError`: an `Error` carrying `status` and `code`. */
    function authApiError(status: number, code: string): Error {
      return Object.assign(new Error('Token has expired or is invalid'), { status, code });
    }

    it('says to request a new code, not to re-check the address', () => {
      const message = describeSignInFailure(authApiError(403, 'otp_expired'));

      expect(message).not.toBe(generic);
      expect(message).toMatch(/request a new/i);
    });

    it('recognises the provider’s raw envelope, where `code` is the number and `error_code` the string', () => {
      expect(
        describeSignInFailure({
          code: 403,
          error_code: 'otp_expired',
          msg: 'Token has expired or is invalid',
        }),
      ).not.toBe(generic);
    });

    it('does not mistake an unrelated 403 for a rejected code', () => {
      expect(describeSignInFailure(authApiError(403, 'some_other_reason'))).toBe(generic);
    });

    it('is distinct from the rate-limit message', () => {
      const codeMessage = describeSignInFailure(authApiError(403, 'otp_expired'));
      const rateLimitMessage = describeSignInFailure(authApiError(429, 'over_email_send_rate_limit'));

      expect(codeMessage).not.toBe(rateLimitMessage);
    });
  });
});

import { AuthNotConfiguredError } from './supabase-auth-client';

/** What the screen says when nothing more specific is known. */
const GENERIC = 'That did not go through. Check the address and try again.';

/**
 * The auth provider's three rate-limit codes.
 *
 * Supabase refuses a second magic link to the same address inside its send window with
 * `over_email_send_rate_limit`; the other two are the same refusal on different
 * channels, and a user meeting either is in the same position — wait, do not retype.
 */
const RATE_LIMIT_CODES: ReadonlySet<string> = new Set([
  'over_email_send_rate_limit',
  'over_request_rate_limit',
  'over_sms_send_rate_limit',
]);

const TOO_MANY_REQUESTS = 429;

/** Read one property off an unknown value without asserting its shape. */
function property(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

/**
 * Whether the provider refused because the caller is going too fast.
 *
 * ⚠ **Duck-typed on the wire facts rather than `instanceof AuthApiError`.** Two shapes
 * genuinely arrive: `@supabase/supabase-js` normalises the response into an `AuthError`
 * carrying `status: 429` and `code: 'over_email_send_rate_limit'`, while the provider's
 * own body is `{"code":429,"error_code":"over_email_send_rate_limit","msg":"…"}` — a
 * *numeric* `code` and the string one field over. Matching on the class would miss the
 * second, and matching on `code` alone would misread the first as an unknown string.
 */
function isRateLimited(error: unknown): boolean {
  const status = property(error, 'status');
  const code = property(error, 'code');
  const errorCode = property(error, 'error_code');

  if (status === TOO_MANY_REQUESTS || code === TOO_MANY_REQUESTS) {
    return true;
  }

  return (
    (typeof code === 'string' && RATE_LIMIT_CODES.has(code)) ||
    (typeof errorCode === 'string' && RATE_LIMIT_CODES.has(errorCode))
  );
}

/**
 * What to tell someone whose sign-in link did not go out.
 *
 * **Three answers, because there are three different things to do about it**, and this
 * app's rule is that a message names a remedy the person can actually act on
 * (`compose-bulletin-outcome.ts` records the same rule for the compose form):
 *
 * - an unconfigured build is not theirs to fix, and saying "check the address" would
 *   send them to re-read an address that was never the problem;
 * - a rate limit clears on its own, and re-checking the address is the one thing that
 *   *cannot* help — the previous link is already in their inbox;
 * - everything else keeps the honest generic, which does not invent an explanation for
 *   a failure nobody has read.
 *
 * ⚠ Extracted from `sign-in.tsx` so it can be asserted without a DOM. The unit project
 * runs in `environment: 'node'` and this repository has no component-test harness, so a
 * branch left inside a component is a branch no test can reach.
 */
export function describeSignInFailure(error: unknown): string {
  if (error instanceof AuthNotConfiguredError) {
    return 'This build has no sign-in service configured yet.';
  }

  if (isRateLimited(error)) {
    return 'Too many sign-in links have been requested for that address. Wait a few minutes and try again — the last link we sent is still valid.';
  }

  return GENERIC;
}

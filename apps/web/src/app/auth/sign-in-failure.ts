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
const FORBIDDEN = 403;

/**
 * GoTrue's one code for "this token does not verify" (`otp_expired`, HTTP 403) —
 * issued for a wrong digit, an expired code, and a code already spent alike, because
 * verification is a single lookup against the stored token and all three leave nothing
 * to find. There is no wire-level way to tell them apart (issue #179), so this app does
 * not pretend to: one message, honest under all three causes, naming the one remedy
 * that works regardless — request a new code.
 */
const CODE_REJECTED_CODE = 'otp_expired';

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
 * Whether the provider refused a one-time code, under either shape `isRateLimited`
 * above documents: `AuthApiError`'s normalised `status`/`code`, or the provider's raw
 * `code`/`error_code` envelope — where the numeric HTTP status arrives under `code`,
 * not `status`. Unlike `isRateLimited`, a bare 403 is not enough by itself in either
 * shape: plenty of unrelated refusals are also 403, so the string reason must match too.
 */
function isCodeRejected(error: unknown): boolean {
  const status = property(error, 'status');
  const code = property(error, 'code');
  const errorCode = property(error, 'error_code');

  return (
    (status === FORBIDDEN && code === CODE_REJECTED_CODE) ||
    (code === FORBIDDEN && errorCode === CODE_REJECTED_CODE)
  );
}

/**
 * What to tell someone whose sign-in link — or the code the same email carries — did
 * not go through.
 *
 * **Four answers, because there are four different things to do about it**, and this
 * app's rule is that a message names a remedy the person can actually act on
 * (`compose-bulletin-outcome.ts` records the same rule for the compose form):
 *
 * - an unconfigured build is not theirs to fix, and saying "check the address" would
 *   send them to re-read an address that was never the problem;
 * - a rate limit clears on its own, and re-checking the address is the one thing that
 *   *cannot* help — the last email already sent, link and code alike, is still valid;
 * - a rejected code (wrong, expired, or already used — `isCodeRejected` above) cannot
 *   be told apart from the wire signal alone, so the message is honest about that and
 *   names the one remedy that covers all three: request a new code;
 * - everything else keeps the honest generic, which does not invent an explanation for
 *   a failure nobody has read.
 *
 * ⚠ Extracted from `sign-in.tsx` so it can be asserted without a DOM. The unit project
 * runs in `environment: 'node'`, and this repository's jsdom component harness
 * (`testing/mount-with-api.tsx`) is not wired to auth components, so a branch left
 * inside this screen is a branch no test can reach.
 */
export function describeSignInFailure(error: unknown): string {
  if (error instanceof AuthNotConfiguredError) {
    return 'This build has no sign-in service configured yet.';
  }

  if (isRateLimited(error)) {
    return 'Too many sign-in attempts for that address. Wait a few minutes and try again — the last email we sent is still valid.';
  }

  if (isCodeRejected(error)) {
    return 'That code did not match — it may be mistyped, expired, or already used. Request a new sign-in email and enter the fresh code.';
  }

  return GENERIC;
}

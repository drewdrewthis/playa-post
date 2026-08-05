import {
  HANDLE_CHARSET,
  HANDLE_MAX_LENGTH,
  HANDLE_MIN_LENGTH,
  normalizeHandle,
  type Handle,
} from './handle';
import {
  HandleInvalidCharsetError,
  HandleReservedError,
  HandleTooLongError,
  HandleTooShortError,
} from './user.errors';

/**
 * Handles nobody may claim (ADR-0008:54).
 *
 * Two kinds, deliberately mixed: words that imply operator authority (`admin`,
 * `support`, `steward`, `operator` — the ADR's own examples) and words a URL or a
 * client route would collide with. Both are impersonation surfaces in a product
 * where a handle is how one person recognises another.
 *
 * Stored normalised, and compared against the normalised submission, so `Admin` is
 * refused for the same reason `admin` is.
 */
export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  'about',
  'admin',
  'administrator',
  'api',
  'auth',
  'help',
  'login',
  'logout',
  'moderator',
  'official',
  'operator',
  'playapost',
  'playa_post',
  'root',
  'security',
  'settings',
  'signin',
  'signup',
  'staff',
  'steward',
  'support',
  'system',
]);

/**
 * Apply every handle rule that needs nothing but the submitted string.
 *
 * Three of ADR-0008's five handle rules are decidable here — length, charset, and the
 * reserved-word blocklist — which is what makes their feature-file scenarios `@unit`
 * with no I/O. The other two (case collision and confusable collision) are questions
 * about *other* rows and belong to the repository.
 *
 * **Normalisation happens before validation, not after.** `DustStorm` is normalised to
 * `duststorm` and accepted here; whether it is available is then a uniqueness question
 * the database answers. Validating the raw string against ADR-0008:54's lowercase-only
 * charset would reject it as a charset violation and make the case-collision scenario
 * unreachable.
 *
 * Rules are checked longest-bound first so the refusal names the rule a reader would
 * name: a 25-character run of `a` is over-length, not out-of-charset.
 *
 * @param rawHandle - Exactly what the user submitted, unnormalised.
 * @returns the normalised handle, branded so it may be written.
 * @throws {HandleTooLongError} over {@link HANDLE_MAX_LENGTH} characters.
 * @throws {HandleTooShortError} under {@link HANDLE_MIN_LENGTH} characters.
 * @throws {HandleInvalidCharsetError} containing anything outside `[a-z0-9_]`.
 * @throws {HandleReservedError} on the {@link RESERVED_HANDLES} blocklist.
 */
export function validateHandle(rawHandle: string): Handle {
  const handle = normalizeHandle(rawHandle);

  if (handle.length > HANDLE_MAX_LENGTH) {
    throw new HandleTooLongError();
  }
  if (handle.length < HANDLE_MIN_LENGTH) {
    throw new HandleTooShortError();
  }
  if (!HANDLE_CHARSET.test(handle)) {
    throw new HandleInvalidCharsetError();
  }
  if (RESERVED_HANDLES.has(handle)) {
    throw new HandleReservedError();
  }

  return handle as Handle;
}

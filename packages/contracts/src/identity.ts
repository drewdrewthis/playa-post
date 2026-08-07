/** Longest `displayName` the server accepts. Mirrors `DISPLAY_NAME_MAX_LENGTH`. */
export const DISPLAY_NAME_MAX_LENGTH = 80;

/**
 * Structured reasons `identity.completeOnboarding` refuses a handle.
 *
 * The **codes** are the server's (it puts them on the error envelope as
 * `data.applicationCode`); the **copy** is the client's. Enumerated here so a client
 * renders five distinct messages rather than one "something went wrong" — a handle
 * rule the user cannot see is a handle rule the user cannot satisfy.
 */
export const HANDLE_REJECTION_CODES = [
  'HANDLE_RESERVED',
  'HANDLE_TAKEN',
  'HANDLE_CONFUSABLE',
  'HANDLE_CHARSET',
  'HANDLE_LENGTH',
] as const;

/** One of {@link HANDLE_REJECTION_CODES}. */
export type HandleRejectionCode = (typeof HANDLE_REJECTION_CODES)[number];

/** `identity.completeOnboarding` input. */
export interface CompleteOnboardingRequest {
  readonly handle: string;
  readonly displayName: string;
}

/** `identity.completeOnboarding` output — the caller's own row, never anyone else's. */
export interface OnboardedUser {
  readonly userId: string;
  readonly handle: string;
  readonly displayName: string;
}

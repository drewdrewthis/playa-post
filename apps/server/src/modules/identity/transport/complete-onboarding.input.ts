import { z } from 'zod';

/**
 * The longest display name this API accepts.
 *
 * A transport concern, not a domain rule: nothing in ADR-0008 constrains a display
 * name beyond `not null`, and a person's name is theirs. This bound exists so the
 * column cannot be used as free storage, and it lives here because "how big may a
 * request field be" is a question about the wire, not about identity.
 */
export const DISPLAY_NAME_MAX_LENGTH = 80;

/**
 * `identity.completeOnboarding`'s input.
 *
 * **`handle` is validated as `z.string()` and nothing more, deliberately.** Every
 * handle rule — length, charset, reserved words — lives in `domain/handle.policy.ts`,
 * and restating any of them here would make the transport reject first: a
 * 25-character handle would come back as a generic `BAD_REQUEST` instead of
 * `HANDLE_TOO_LONG`, and M2-AC25's evidence is precisely the six structured codes. One
 * rule, one home, and the home is the domain.
 *
 * **No `userId`, `viewerId`, `actorId`, or `ownerId` field, here or anywhere**
 * (ADR-0002:180-181). The actor is derived from the verified token at the context
 * boundary; a caller asserting who it is would be total, silent impersonation (R14).
 * `tests/fitness/viewer-id-provenance.fitness.test.ts` walks the built router and
 * fails on any such field.
 */
export const completeOnboardingInput = z.object({
  handle: z.string(),
  displayName: z.string().trim().min(1).max(DISPLAY_NAME_MAX_LENGTH),
});

export type CompleteOnboardingInput = z.infer<typeof completeOnboardingInput>;

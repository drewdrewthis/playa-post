import { z } from 'zod';

import { displayNameSchema } from './display-name';

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
 *
 * **`displayName` is validated by the shared {@link displayNameSchema}**, which
 * `identity.updateDisplayName` also takes — the name a person may choose at sign-up
 * and the name they may rename themselves to are one rule with one home (decision
 * D15).
 */
export const completeOnboardingInput = z.object({
  handle: z.string(),
  displayName: displayNameSchema,
});

export type CompleteOnboardingInput = z.infer<typeof completeOnboardingInput>;

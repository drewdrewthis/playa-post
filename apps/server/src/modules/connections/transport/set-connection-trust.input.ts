import { z } from 'zod';

/**
 * `connections.trust.set`'s input.
 *
 * **The person is named `subjectUserId`, not `userId`.** `userId` is on
 * ADR-0002:180-181's forbidden list and `tests/fitness/viewer-id-provenance.fitness.test.ts`
 * fails the build on any procedure input carrying it — the rule exists because one
 * caller-supplied identity field is total, silent impersonation (R14). Naming the
 * *subject* of an opinion is a different thing from asserting who is holding it, and
 * the field name has to make that difference visible; `subject_id` is also what the
 * column is called.
 *
 * `subjectUserId` is checked as a UUID because a malformed one reaches a `uuid` column
 * and comes back as a driver-level 500 — a wire concern, not a domain rule.
 *
 * **`trust` is `z.number()` and nothing more**, for the reason
 * `modules/identity/transport/complete-onboarding.input.ts` gives: the 0-100 scale is
 * `domain/connection-trust.policy.ts`'s rule, and restating it here would make a 101
 * come back as a generic `BAD_REQUEST` instead of the stable `TRUST_OUT_OF_RANGE` code
 * M2-AC18 asks for.
 */
export const setConnectionTrustInput = z.object({
  subjectUserId: z.uuid(),
  trust: z.number(),
});

export type SetConnectionTrustInput = z.infer<typeof setConnectionTrustInput>;

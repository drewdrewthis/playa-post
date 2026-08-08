import { z } from 'zod';

/**
 * One limit on the wire.
 *
 * **`minTrust` is `z.number().nullable()` and nothing more**, for the reason
 * `connections/transport/set-connection-trust.input.ts` gives: the 0-100 scale and the
 * integers-only rule are `domain/privacy-limits.policy.ts`'s, and restating them here
 * would make a 101 come back as a generic `BAD_REQUEST` instead of the stable
 * `PRIVACY_LIMIT_OUT_OF_RANGE` code M2-AC18 asks for.
 *
 * ⚠ `.nullable()`, never `.optional()`. `null` is the design's `ANYONE` — a value the
 * user picked — and an omitted field would be indistinguishable from a client that
 * forgot to send one. With `exactOptionalPropertyTypes` on, the two are different types
 * as well as different meanings.
 */
const disclosureLimitInput = z.object({
  minTrust: z.number().nullable(),
  maxDegree: z.number(),
});

/**
 * `privacy.setLimits`' input.
 *
 * **Nothing here names whose limits these are.** They are always the caller's:
 * ADR-0002:180-181 forbids a caller-supplied identity field and
 * `tests/fitness/viewer-id-provenance.fitness.test.ts` walks this router to prove it.
 *
 * Both limits are required together — the screen always knows all four values, and a
 * partial write would let two requests interleave into a policy nobody chose.
 */
export const setPrivacyLimitsInput = z.object({
  name: disclosureLimitInput,
  note: disclosureLimitInput,
});

export type SetPrivacyLimitsInput = z.infer<typeof setPrivacyLimitsInput>;

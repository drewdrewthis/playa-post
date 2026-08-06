import { z } from 'zod';

/**
 * The input for both moderation procedures — `moderation.report` and
 * `moderation.dismiss`.
 *
 * One schema for both, because they take the same claim and must answer a bulletin the
 * caller may not touch the same way. Two schemas would be two places for one of them to
 * grow a field the other refuses.
 *
 * Restated here rather than imported from `modules/bulletins/transport`: the wire is a
 * contract owned by the module that serves it, and a shared input schema would make one
 * module's procedure signature change when the other's did. Its shape agreeing with
 * `bulletins`' is a fact about the product, not a dependency.
 *
 * `bulletinId` is checked as a UUID because a malformed one reaches a `uuid` column and
 * comes back as a driver-level 500 — a wire concern, not a domain rule.
 *
 * ⚠ That check is **not** an existence check and must never become one. A well-formed
 * UUID naming a bulletin the caller may not see gets `MODERATION_TARGET_UNAVAILABLE`,
 * byte-identical to one that never existed (ADR-0002 §10, B17, M2-AC14).
 *
 * ⚠ **No `viewerId`, `userId`, `actorId`, or `ownerId` field** (ADR-0002:180-181). The
 * reporter is the resolved actor; a caller naming one would be reporting in somebody
 * else's name. `tests/fitness/viewer-id-provenance.fitness.test.ts` walks the built
 * router and fails on any such field.
 */
export const moderationTargetInput = z.object({
  bulletinId: z.uuid(),
});

export type ModerationTargetInput = z.infer<typeof moderationTargetInput>;

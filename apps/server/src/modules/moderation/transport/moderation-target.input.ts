import { z } from 'zod';

/**
 * `moderation.dismiss`'s input: one bulletin, and nothing else.
 *
 * ⚠ **Deliberately not shared with `moderation.report` any more.** It was, while the two
 * took the same claim — and this comment used to say two schemas "would be two places
 * for one of them to grow a field the other refuses". The field arrived: a report now
 * carries a reason and an account (`moderation-report.input.ts`), and a dismissal must
 * not be able to carry either. Dismissing is "not for me"; it makes no assertion about
 * the bulletin or its author, and a schema that accepted a reason here would let a
 * client file one that nothing reads and nobody acts on.
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

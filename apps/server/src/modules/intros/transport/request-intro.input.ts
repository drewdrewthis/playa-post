import { z } from 'zod';

import type { RequestIntroCommand } from '../application/request-intro.service';

/**
 * `intros.request`'s input.
 *
 * **`note` is `z.string()` and nothing more, deliberately.** Its bounds live in
 * `domain/intro-note.policy.ts`, and restating them here would make an over-long note
 * come back as a generic `BAD_REQUEST` instead of the stable `INTRO_CONTENT_INVALID`
 * code — and would put a second copy of the rule where the first one could not see it.
 *
 * Both identifiers are checked as UUIDs because a malformed one reaches a `uuid` column
 * and comes back as a driver-level 500 — a wire concern, not a domain rule.
 *
 * ⚠ Those checks are **not** existence checks and must never become ones. A well-formed
 * UUID naming nobody, one naming a real person at the wrong distance, and one naming a
 * genuine first-degree connection who does not know the target all get the identical
 * `INTRO_UNAVAILABLE` (ADR-0002 §10, B17).
 *
 * **No `viewerId`, `userId`, `actorId`, or `ownerId` field** (ADR-0002:180-181). The
 * requester is the resolved actor; a caller asserting who is asking would be requesting
 * an introduction in somebody else's name, which is worse than reading one. `viaUserId`
 * and `targetUserId` name the *other* two parties — claims the server then authorizes.
 */
export const requestIntroInput = z.object({
  targetUserId: z.uuid(),
  viaUserId: z.uuid(),
  note: z.string(),
});

export type RequestIntroInput = z.infer<typeof requestIntroInput>;

/**
 * Turn a validated input into the use case's command fields.
 *
 * A function rather than an inline spread, for the reason `create-bulletin.input.ts`
 * gives: the mapping renames two fields, and a second copy of that rename is a second
 * place to swap `via` and `target` — a mistake that would still compile and would ask
 * the wrong person for an introduction to the wrong one.
 *
 * @returns Everything the command needs except `requesterId`, which is the resolved
 *   actor and is never derivable from input.
 */
export function requestIntroCommandFields(
  input: RequestIntroInput,
): Omit<RequestIntroCommand, 'requesterId'> {
  return {
    viaId: input.viaUserId,
    targetId: input.targetUserId,
    note: input.note,
  };
}

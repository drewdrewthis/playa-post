import { z } from 'zod';

import type { RespondToIntroCommand } from '../application/respond-to-intro.service';
import { INTRO_RESPONSE } from '../domain/intro-request';

/**
 * `intros.respond`'s input — the target's answer to an introduction (issue #166).
 *
 * ⚠ **One object with an enum, not a discriminated union**, and the difference from
 * `decide-intro.input.ts` is the point rather than an inconsistency: `intros.decide`'s
 * two arms take different fields (#175 gave `pass_on` a required note), so a union is the
 * only shape that can say so. Both answers here take exactly the same fields — the id and
 * the answer — because neither carries content, so a union would be two identical arms
 * pretending to describe a difference.
 *
 * ⚠ **`strictObject`, for `decide-intro.input.ts`'s reason.** Zod's default object strips
 * unknown keys, so a `note` sent with either answer would vanish silently and its writer
 * would believe somebody might read it. Nobody would: an acceptance is disclosed by the
 * connection it makes, and a decline is never disclosed at all. Refusing the field is the
 * honest answer to text written for a reader who does not exist.
 *
 * ⚠ There is no `status` field and must never be one. A caller says what they are doing —
 * accept, or decline — and the server decides what that stores; letting a client post
 * `'accepted'` would be letting them name their own outcome.
 *
 * **No `viewerId`, `userId`, `actorId`, or `ownerId` field** (ADR-0002:180-181). The
 * target is the resolved actor, compared against the row's stored `target_id` inside the
 * update — so there is no field here through which somebody could answer an introduction
 * that is not theirs, and no reply that would tell them whose it is.
 */
export const respondToIntroInput = z.strictObject({
  introRequestId: z.uuid(),
  response: z.enum([INTRO_RESPONSE.accept, INTRO_RESPONSE.decline]),
});

export type RespondToIntroInput = z.infer<typeof respondToIntroInput>;

/**
 * Turn a validated input into the use case's command fields.
 *
 * A function rather than an inline spread, matching `request-intro.input.ts` and
 * `decide-intro.input.ts`: the router names one mapping instead of restating the field
 * list, so a field added to the command has one place to be wired rather than two that
 * can drift.
 *
 * @returns Everything the command needs except `actorId`, which is the resolved actor and
 *   is never derivable from input.
 */
export function respondToIntroCommandFields(
  input: RespondToIntroInput,
): Omit<RespondToIntroCommand, 'actorId'> {
  return {
    introRequestId: input.introRequestId,
    response: input.response,
  };
}

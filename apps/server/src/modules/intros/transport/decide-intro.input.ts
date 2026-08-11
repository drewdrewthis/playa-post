import { z } from 'zod';

import type { DecideIntroCommand } from '../application/decide-intro.service';
import { INTRO_DECISION } from '../domain/intro-request';

/**
 * `intros.decide`'s input — **a discriminated union on `decision`**, because the two
 * decisions do not take the same fields (issue #175).
 *
 * `pass_on` requires the via's own note; `decline` refuses one. A single object with an
 * optional `note` would say neither: it would let a decline carry text nobody may read,
 * and would leave "a pass-on must have one" to a check further in, where a client
 * discovers it only by being refused.
 *
 * ⚠ **`strictObject`, unlike every other input schema in this tree**, and only because of
 * what the union is for. Zod's default object *strips* unknown keys, so a `note` sent
 * with a `decline` would vanish silently and its writer would believe the requester might
 * one day read it. Refusing it is the honest answer to somebody who wrote words for a
 * reader who does not exist.
 *
 * ⚠ **`note` is bounded here only at 1 character, not at 4000.** Its real bounds live in
 * `domain/intro-note.policy.ts` for `request-intro.input.ts`'s reason — restating the
 * maximum would make an over-long note come back as a generic `BAD_REQUEST` instead of
 * the stable `INTRO_CONTENT_INVALID`. The minimum is here because "this branch has a
 * note" is what the union is *for*: a `pass_on` carrying `note: ''` would otherwise
 * type-check its way past the discriminator before the domain saw it, and the schema
 * would be describing a shape the server does not accept.
 *
 * ⚠ There is no `status` field and must never be one. A caller says what they are doing
 * — pass it on, or decline — and the server decides what that stores; letting a client
 * post `'requested'` would be letting them un-decide somebody else's answer.
 *
 * **No `viewerId`, `userId`, `actorId`, or `ownerId` field** (ADR-0002:180-181). The via
 * is the resolved actor, compared against the row's stored `via_id` inside the update —
 * so there is no field here through which somebody could decide a request that is not
 * theirs, and no reply that would tell them whose it is.
 */
export const decideIntroInput = z.discriminatedUnion('decision', [
  z.strictObject({
    introRequestId: z.uuid(),
    decision: z.literal(INTRO_DECISION.passOn),
    note: z.string().min(1),
  }),
  z.strictObject({
    introRequestId: z.uuid(),
    decision: z.literal(INTRO_DECISION.decline),
  }),
]);

export type DecideIntroInput = z.infer<typeof decideIntroInput>;

/**
 * Turn a validated input into the use case's command fields.
 *
 * A function rather than an inline spread, for `request-intro.input.ts`'s reason and one
 * of its own: **narrowing the union belongs beside the union**. The router would
 * otherwise carry an `if (input.decision === …)` — a third place expressing the
 * difference between the two decisions, in the layer that enforces neither half of it.
 *
 * @returns Everything the command needs except `actorId`, which is the resolved actor and
 *   is never derivable from input.
 */
export function decideIntroCommandFields(
  input: DecideIntroInput,
): Omit<DecideIntroCommand, 'actorId'> {
  return {
    introRequestId: input.introRequestId,
    decision: input.decision,
    // Omitted rather than `undefined` on the decline branch: the command's field means
    // "a note was submitted", and `exactOptionalPropertyTypes` is what keeps the
    // difference between an absent key and a present empty one checkable.
    ...(input.decision === INTRO_DECISION.passOn ? { viaNote: input.note } : {}),
  };
}

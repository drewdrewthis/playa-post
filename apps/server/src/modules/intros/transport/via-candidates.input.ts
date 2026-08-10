import { z } from 'zod';

/**
 * `intros.viaCandidates`' input.
 *
 * `targetUserId` is checked as a UUID because a malformed one reaches a `uuid` argument
 * and comes back as a driver-level 500 — a wire concern, not a domain rule (the same
 * argument `bulletin-id.input.ts` makes).
 *
 * ⚠ That check is **not** an existence check and must never become one. A well-formed
 * UUID naming nobody, or naming somebody the caller cannot reach, returns an **empty
 * list** — never an error, and never a different error from the other case (ADR-0002
 * §10, B17).
 *
 * **No `viewerId`, `userId`, `actorId`, or `ownerId` field** (ADR-0002:180-181). The
 * requester is the resolved actor. `targetUserId` is not one of those names on purpose:
 * it names the *other* party, which is a claim the server then authorizes, not a claim
 * about who is asking — the same distinction `pin-note.input.ts`'s `recipientId` makes.
 * `tests/fitness/viewer-id-provenance.fitness.test.ts` walks the built router and fails
 * on any of the four.
 */
export const viaCandidatesInput = z.object({
  targetUserId: z.uuid(),
});

export type ViaCandidatesInput = z.infer<typeof viaCandidatesInput>;

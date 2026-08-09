import { z } from 'zod';

import type { PinNoteCommand } from '../application/pin-note.service';

/**
 * `notes.pin`'s input.
 *
 * **`body` is `z.string()` and nothing more, deliberately.** Its bounds live in
 * `domain/note-content.policy.ts`, and restating them here would make an over-long note
 * come back as a generic `BAD_REQUEST` instead of the stable `NOTE_CONTENT_INVALID` code
 * — and would make the `sync.submitMutations` path reach a *third* copy of the rule.
 *
 * `recipientId` is checked as a UUID because a malformed one reaches a `uuid` column and
 * comes back as a driver-level 500 — a wire concern, not a domain rule (the same
 * argument `bulletin-id.input.ts` makes).
 *
 * ⚠ That check is **not** an existence check and must never become one. A well-formed
 * UUID naming somebody the caller is not connected to gets `NOTE_RECIPIENT_UNREACHABLE`,
 * byte-identical to one naming nobody at all (ADR-0002 §10, B17).
 *
 * **No `authorId`, `userId`, `viewerId`, `actorId`, or `ownerId` field**
 * (ADR-0002:180-181). The author is the resolved actor; a caller asserting authorship
 * would be leaving a note in somebody else's name — which for a private channel is worse
 * than posting in it. `tests/fitness/viewer-id-provenance.fitness.test.ts` walks the
 * built router and fails on any such field. `recipientId` is not one of those names on
 * purpose: it names the *other* party, which is a claim the server then has to authorize,
 * not a claim about who is asking.
 */
export const pinNoteInput = z.object({
  recipientId: z.uuid(),
  body: z.string(),
});

export type PinNoteInput = z.infer<typeof pinNoteInput>;

/**
 * Turn a validated input into the use case's command fields.
 *
 * **Exported because two transports reach one use case**: the tRPC procedure and
 * `sync.submitMutations`' `note.pin` handler, assembled in `composition/container.ts`.
 * The mapping is trivial today and is a function anyway, for the reason
 * `create-bulletin.input.ts` gives: a second copy is a second place for the offline path
 * to drift from the online one, and no type could catch it because both copies would
 * still compile.
 *
 * @returns Everything the command needs except `authorId`, which is the resolved actor
 *   and is never derivable from input.
 */
export function pinNoteCommandFields(input: PinNoteInput): Omit<PinNoteCommand, 'authorId'> {
  return {
    recipientId: input.recipientId,
    body: input.body,
  };
}

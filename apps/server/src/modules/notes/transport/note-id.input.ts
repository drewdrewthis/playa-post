import { z } from 'zod';

/**
 * `notes.getById`'s input — the expanded view's whole claim (#176, decision D14).
 *
 * `noteId` is checked as a UUID because a malformed one reaches a `uuid` column and comes
 * back as a driver-level 500 — a wire concern, not a domain rule (the same argument
 * `bulletin-id.input.ts` and `pin-note.input.ts` make).
 *
 * ⚠ That check is **not** an existence check and must never become one. A well-formed UUID
 * naming a note addressed to somebody else gets `NOTE_GONE`, byte-identical to one naming
 * no note at all (ADR-0002 §10, B17).
 *
 * **No `viewerId`, `userId`, `actorId`, `recipientId`, or `ownerId` field**
 * (ADR-0002:180-181). Unlike `pin`, this procedure names no second party at all: a note
 * has exactly one reader, so the only person it could be read *as* is the caller, and a
 * field naming one could only ever be a claim to be somebody else.
 * `tests/fitness/viewer-id-provenance.fitness.test.ts` walks the built router and fails on
 * any such field.
 */
export const noteIdInput = z.object({
  noteId: z.uuid(),
});

export type NoteIdInput = z.infer<typeof noteIdInput>;

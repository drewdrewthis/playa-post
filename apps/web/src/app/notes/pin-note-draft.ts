import type { PinNoteRequest } from '@playa-post/contracts';

/**
 * Longest note the compose form will let a user pin.
 *
 * ⚠ **A mirror, not the rule.** The rule is
 * `apps/server/src/modules/notes/domain/note-content.policy.ts`, which the web app cannot
 * import (`no-web-to-server-internals`) and which stays authoritative: a draft this file
 * waves through is still refused with `NOTE_CONTENT_INVALID`, and that refusal is
 * rendered rather than swallowed (`pin-note-outcome.ts`). The mirror exists so a user
 * finds out at the keystroke instead of after a round trip.
 */
export const NOTE_BODY_MAX_LENGTH = 4000;

/** Why a note is not pinnable. `null` means it is. */
export type NoteDraftIssue = 'empty' | 'too-long';

/**
 * What is wrong with a note draft.
 *
 * One field, so one issue — a note has no title, no location, and no audience to get
 * wrong (decision D6: a note is not a bulletin, and this shape is where that stops being
 * a slogan).
 */
export interface NoteDraftIssues {
  readonly body: NoteDraftIssue | null;
  /** True when the note may be pinned. Drives the submit button's disabled state. */
  readonly pinnable: boolean;
}

/**
 * Check a note draft against the server's rule, early.
 *
 * The bound is measured **after trimming**, which is what the server's content policy
 * does; measuring the raw value would refuse a note the server would have accepted.
 */
export function inspectNoteDraft(body: string): NoteDraftIssues {
  const trimmed = body.trim();

  const issue: NoteDraftIssue | null =
    trimmed.length === 0 ? 'empty' : trimmed.length > NOTE_BODY_MAX_LENGTH ? 'too-long' : null;

  return { body: issue, pinnable: issue === null };
}

/**
 * How far over the bound a draft is, for the one line that says so.
 *
 * Trimmed, for {@link inspectNoteDraft}'s reason: a count measured over trailing spaces
 * the server would have discarded would contradict the button beside it.
 */
export function noteOverBy(body: string): number {
  return Math.max(0, body.trim().length - NOTE_BODY_MAX_LENGTH);
}

/**
 * Freeze a draft into the payload that will be queued.
 *
 * ⚠ **Called once, at queue time, and never again.** The server hashes this object to
 * tell a replay from a duplicate (`offline/database.ts`), so a caller that rebuilds it on
 * a retry — even identically — gets `IDEMPOTENCY_KEY_REUSE` instead of `replayed`.
 *
 * `recipientId` is carried through untouched. It is a claim the server authorizes inside
 * the insert statement itself, and a client that "validated" it first would be building
 * the reachability probe `notes.ts` forbids.
 */
export function buildPinNotePayload(recipientId: string, body: string): PinNoteRequest {
  return { recipientId, body: body.trim() };
}

/**
 * Longest note an intro request will let a user send.
 *
 * ⚠ **A mirror, not the rule.** The rule is
 * `apps/server/src/modules/intros/domain/intro-note.ts`, which the web app cannot import
 * (`no-web-to-server-internals`) and which stays authoritative: a draft this file waves
 * through is still refused with `INTRO_CONTENT_INVALID`, and that refusal is rendered
 * rather than swallowed (`intro-copy.ts`). The mirror exists so a user finds out at the
 * keystroke instead of after a round trip.
 *
 * ⚠ **Deliberately the same number as `notes/pin-note-draft.ts`'s
 * `NOTE_BODY_MAX_LENGTH`, and deliberately not that constant** — the server states the
 * two bounds separately, for two policies, precisely so either can move without the
 * other. Importing one here would re-couple on the client what the server uncoupled.
 */
export const INTRO_NOTE_MAX_LENGTH = 4000;

/** Why an intro note cannot be sent. `null` means it can. */
export type IntroNoteIssue = 'empty' | 'too-long';

/**
 * What is wrong with an intro note.
 *
 * One field, so one issue: an intro request has a note and two identifiers the viewer
 * chose from a list, and neither identifier is something a draft can get wrong.
 */
export interface IntroNoteIssues {
  readonly note: IntroNoteIssue | null;
  /** True when the note may be sent. Drives the submit button's disabled state. */
  readonly sendable: boolean;
}

/**
 * Check an intro note against the server's rule, early.
 *
 * The bound is measured **after trimming**, which is what the server's content policy
 * does; measuring the raw value would refuse a note the server would have accepted, and
 * would let a whitespace-only note look sendable.
 */
export function inspectIntroNote(note: string): IntroNoteIssues {
  const trimmed = note.trim();

  const issue: IntroNoteIssue | null =
    trimmed.length === 0 ? 'empty' : trimmed.length > INTRO_NOTE_MAX_LENGTH ? 'too-long' : null;

  return { note: issue, sendable: issue === null };
}

/**
 * How far over the bound a draft is, for the one line that says so.
 *
 * Trimmed, for {@link inspectIntroNote}'s reason: a count measured over trailing spaces
 * the server would have discarded would contradict the button beside it.
 */
export function introNoteOverBy(note: string): number {
  return Math.max(0, note.trim().length - INTRO_NOTE_MAX_LENGTH);
}

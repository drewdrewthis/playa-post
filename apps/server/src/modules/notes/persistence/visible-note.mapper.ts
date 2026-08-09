import type { VisibleNote, VisibleNoteAuthor } from '../application/visible-note';

/**
 * One row as `app.visible_notes` returns it.
 *
 * Hand-written rather than derived from `@playa-post/database`'s generated types, which
 * is the exception this file has to justify: `pnpm db:types` describes tables and views,
 * not a set-returning function's result. `visible-notes.sql`'s `returns table (...)`
 * block is the contract, and `visible-notes-migration.integration.test.ts` pins the
 * function's catalog shape so a signature change cannot pass silently.
 *
 * There is no `recipient_id` column on the function at all, not merely absent from this
 * type: the only viewer who can produce a row is the recipient, so projecting it would
 * be the database echoing back who is asking.
 */
export interface VisibleNoteRow {
  readonly note_id: string;
  /**
   * `null` when the note's author is no longer in the viewer's visible world.
   *
   * Every author column is projected from the authorized set rather than from
   * `app.notes`, so the LEFT JOIN finding nobody nulls the identifier too. That is the
   * point of it: the raw `app.notes.author_id` of a person the graph has excluded is
   * never in the function's select list, so there is no shape of this row that hands one
   * back.
   */
  readonly author_id: string | null;
  readonly body: string;
  readonly created_at: Date;
  /** `null` alongside {@link VisibleNoteRow.author_id} — there is no person to describe. */
  readonly author_disclosure: string | null;
  /** `null` for an author below `full` disclosure — the column is not projected. */
  readonly author_display_name: string | null;
  /** `null` for an author below `full` disclosure. */
  readonly author_handle: string | null;
}

/**
 * Assemble the author card, or decline to.
 *
 * ⚠ The card is **whole or absent**, never partially assembled. `author_id` and
 * `author_disclosure` come from the same LEFT-joined row, so in practice they are null
 * together; requiring both is what lets the compiler see that, and it is the right
 * failure direction anyway — a row that somehow carried one without the other describes
 * a person this function could not project, and the answer to that is no card rather
 * than a card with a hole in it.
 */
function toAuthor(row: VisibleNoteRow): VisibleNoteAuthor | undefined {
  if (row.author_id === null || row.author_disclosure === null) {
    return undefined;
  }

  return {
    userId: row.author_id,
    disclosure: row.author_disclosure,
    ...(row.author_display_name === null ? {} : { displayName: row.author_display_name }),
    ...(row.author_handle === null ? {} : { handle: row.author_handle }),
  };
}

/**
 * Translate a projected row into the {@link VisibleNote} read model.
 *
 * ⚠ The author's identity fields — and the whole author card, when there is no author to
 * show — are **omitted, not set to `null`**. A `null` says "there is a name and you are
 * not getting it"; an absent key says "there is no name here", which is the shape
 * ADR-0002 §6a's `topology_only` author actually has and the one
 * `exactOptionalPropertyTypes` lets the compiler keep honest. It is also what makes
 * `JSON.stringify` of a below-`full` author carry no identity keys at all, and of an
 * author-less note carry no `author` key at all.
 */
export function toVisibleNote(row: VisibleNoteRow): VisibleNote {
  const author = toAuthor(row);

  return {
    id: row.note_id,
    body: row.body,
    createdAt: row.created_at,
    ...(author === undefined ? {} : { author }),
  };
}

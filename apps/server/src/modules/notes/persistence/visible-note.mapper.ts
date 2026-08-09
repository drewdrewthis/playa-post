import type { VisibleNote } from '../application/visible-note';

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
  readonly author_id: string;
  readonly body: string;
  readonly created_at: Date;
  readonly author_disclosure: string;
  /** `null` for an author below `full` disclosure — the column is not projected. */
  readonly author_display_name: string | null;
  /** `null` for an author below `full` disclosure. */
  readonly author_handle: string | null;
}

/**
 * Translate a projected row into the {@link VisibleNote} read model.
 *
 * ⚠ The author's identity fields are **omitted, not set to `null`**. A `null` says
 * "there is a name and you are not getting it"; an absent key says "there is no name
 * here", which is the shape ADR-0002 §6a's `topology_only` author actually has and the
 * one `exactOptionalPropertyTypes` lets the compiler keep honest. It is also what makes
 * `JSON.stringify` of a below-`full` author carry no identity keys at all.
 */
export function toVisibleNote(row: VisibleNoteRow): VisibleNote {
  return {
    id: row.note_id,
    body: row.body,
    createdAt: row.created_at,
    author: {
      userId: row.author_id,
      disclosure: row.author_disclosure,
      ...(row.author_display_name === null ? {} : { displayName: row.author_display_name }),
      ...(row.author_handle === null ? {} : { handle: row.author_handle }),
    },
  };
}

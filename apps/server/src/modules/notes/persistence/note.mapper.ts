import type { Database, Selectable } from '@playa-post/database';

import type { Note } from '../domain/note';

/**
 * One `app.notes` row as the generated schema describes it.
 *
 * Derived from `@playa-post/database`'s checked-in types rather than hand-written, so a
 * migration that changes the table breaks `pnpm typecheck` here instead of producing
 * wrong values at runtime.
 */
export type NoteRow = Selectable<Database['app.notes']>;

/** Translate a database row into the domain's {@link Note}. */
export function toNote(row: NoteRow): Note {
  return {
    id: row.id,
    authorId: row.author_id,
    recipientId: row.recipient_id,
    body: row.body,
    createdAt: row.created_at,
  };
}

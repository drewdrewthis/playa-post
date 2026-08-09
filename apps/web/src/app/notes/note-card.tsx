import type { JSX } from 'react';

import type { Note } from '@playa-post/contracts';

import { relativeTime } from '../bulletins/relative-time';
import { PersonIdentity } from '../people/person-identity';

import { noteAuthorCard } from './note-author';

import './note-card.css';

/**
 * One note on the viewer's own board — the comp's `noteLook` card
 * (`design/Playa Post.dc.html:726-729`): dashed, tinted, tilted half a degree off true,
 * carrying a PRIVATE pill.
 *
 * **The body is here, and there is no sheet behind it.** Every other card on this board
 * is a headline that opens into `bulletins.getById`; a note has no title to be a headline
 * and there is deliberately no `notes.getById` to open — `notes.router.ts` explains why
 * the module has exactly two procedures. A tap would raise a sheet whose entire contents
 * were already on the card, so the card is not a tap target.
 *
 * ⚠ The author renders through {@link PersonIdentity}, which is where §6a's "no derived
 * placeholder" rule lives — and only when there is an author card to render at all. An
 * author who has left this viewer's world is absent from the payload, and the card then
 * carries no author line: the note survives, unnamed. `note-author.ts` holds that
 * distinction, and the reasons it is not a placeholder.
 */
export function NoteCard({
  note,
  now,
}: {
  readonly note: Note;
  /**
   * The moment the age is measured against, passed in rather than read here so every row
   * on one render agrees — the same contract `BulletinCard` takes.
   */
  readonly now: Date;
}): JSX.Element {
  const age = relativeTime(note.createdAt, now);
  const author = noteAuthorCard(note);

  return (
    <article className="note-card" data-testid={`board-note-card-${note.id}`}>
      <div className="note-card__header">
        <span className="note-card__type">Note</span>

        {/* The comp's pill slot. For a note it always says the same thing, because a note
            is always the same thing. */}
        <span className="note-card__private">Private</span>

        {age === null ? null : <span className="note-card__time">{age}</span>}
      </div>

      <p className="note-card__body">{note.body}</p>

      {author === null ? null : (
        <p className="note-card__author">
          <PersonIdentity identity={author} />
        </p>
      )}
    </article>
  );
}

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
 * **The card opens (#176, decision D14).** It used to be the one row on this board that
 * was not a tap target, on the reasoning that a note carries its whole text already and a
 * sheet would repeat it. D14 reversed that: the expanded view exists to *answer* the note,
 * not to re-read it — `note-detail-sheet.tsx` carries the pin-back control, and
 * `notes.getById` re-checks the note against this viewer at the moment they open it. The
 * body stays on the card regardless, because a note has no title to be a headline with.
 *
 * The whole card is one button rather than a `<div>` with a click handler, for the reason
 * `BulletinCard` gives: opening has to work from a keyboard, and a button is the element
 * that already does. Its accessible name is the card's own content — for a note that is
 * the note itself, which is exactly what somebody needs to hear before deciding to open it.
 *
 * ⚠ Everything inside the button is a `<span>`, deliberately. A `<p>` inside a `<button>`
 * is invalid HTML and browsers reparent it, which breaks the card's own layout;
 * `note-card.css` gives the two text spans their block display back.
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
  onOpen,
}: {
  readonly note: Note;
  /**
   * The moment the age is measured against, passed in rather than read here so every row
   * on one render agrees — the same contract `BulletinCard` takes.
   */
  readonly now: Date;
  readonly onOpen: (note: Note) => void;
}): JSX.Element {
  const age = relativeTime(note.createdAt, now);
  const author = noteAuthorCard(note);

  return (
    <article className="note-card" data-testid={`board-note-card-${note.id}`}>
      <button
        className="note-card__open"
        data-testid="note-open-button"
        type="button"
        onClick={() => {
          onOpen(note);
        }}
      >
        <span className="note-card__header">
          <span className="note-card__type">Note</span>

          {/* The comp's pill slot. For a note it always says the same thing, because a
              note is always the same thing. */}
          <span className="note-card__private">Private</span>

          {age === null ? null : <span className="note-card__time">{age}</span>}
        </span>

        <span className="note-card__body">{note.body}</span>

        {author === null ? null : (
          <span className="note-card__author">
            <PersonIdentity identity={author} />
          </span>
        )}
      </button>
    </article>
  );
}

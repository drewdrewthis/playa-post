import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useRef, type JSX } from 'react';
import { Link } from 'react-router';

import type { Note } from '@playa-post/contracts';

import { useApi } from '../api/api-provider';
import { applicationErrorCode } from '../api/client';
import { relativeTime } from '../bulletins/relative-time';
import { GRAPH_LIST_QUERY_KEY } from '../graph/graph-query-keys';
import { PersonIdentity } from '../people/person-identity';

import { noteAuthorCard } from './note-author';
import { describeNotePinBack, type NotePinBack } from './note-pin-back';
import { pinNoteHref } from './note-recipient';
import { noteSheetTitle } from './note-sheet-title';

import './note-detail-sheet.css';

/**
 * One note in full, with the way to answer it (#176, decision D14).
 *
 * The card already carries the body, so this sheet is not here to reveal text — it is here
 * because a note you have been left is a thing you answer, and until now the board had
 * nowhere to do that from. It reads `notes.getById`, the server's authoritative copy
 * re-checked against this viewer at the moment they open it, and falls back to the card
 * the sheet was opened from while that is in flight or when the network is gone. The
 * fallback is not a placeholder: it is the same note, from the read this board was already
 * built out of, so a note still opens with the radio off.
 *
 * **"Pin a note back" is a new note, not an operation on this one.** It routes into the
 * existing compose screen with the author preselected (`/board/new?noteTo=<id>`), so the
 * write, its degree-1 gate, and its offline queue are `notes.pin`'s and are unchanged.
 * Notes remain immutable and pin-only — no unpin, no archive, no edit — which decision D14
 * revisited and deliberately kept, and which is why this sheet has no action row of the
 * kind `bulletin-detail-sheet.tsx` carries.
 *
 * ⚠ **An author who has left this viewer's world gets no control at all**, because there
 * is nobody to address: the payload carries no `userId` for them, and building one from
 * anywhere else is the §6a bug `note-author.ts` exists to prevent. `note-pin-back.ts` holds
 * that decision and the three others beside it.
 *
 * Four ways out, matching the bulletin sheet, because a sheet that traps somebody is worse
 * than no sheet: the CLOSE control, Escape, a tap on the scrim, and — no drag. The drag is
 * the one affordance not copied: this sheet's body is the note, `white-space: pre-wrap` and
 * arbitrarily long, so a downward drag over it is far more likely to be somebody scrolling
 * what they are reading than somebody dismissing it.
 */
export function NoteDetailSheet({
  note,
  now,
  onClose,
}: {
  /** The note as the board's list read it — the sheet's fallback, and its identity. */
  readonly note: Note;
  readonly now: Date;
  readonly onClose: () => void;
}): JSX.Element {
  const api = useApi();
  const titleId = useId();
  const sheetRef = useRef<HTMLElement>(null);

  const detail = useQuery({
    queryKey: ['notes', 'getById', note.id],
    queryFn: () => api.query('notes.getById', { noteId: note.id }),
  });

  /*
   * The same key the graph screen and the bulletin sheet read under, so opening a note
   * after visiting either costs nothing. A `NoteAuthor` carries a disclosure and no
   * degree; this is the only payload that carries one, and the degree is what decides
   * whether pinning back can be offered.
   */
  const graph = useQuery({
    queryKey: GRAPH_LIST_QUERY_KEY,
    queryFn: () => api.query('graph.list', undefined),
  });

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  // Focus moves into the sheet on open, so a keyboard user's next Tab is inside it and
  // Escape reaches this handler rather than whichever card they came from.
  useEffect(() => {
    sheetRef.current?.focus();
  }, []);

  const shown = detail.data ?? note;
  const age = relativeTime(shown.createdAt, now);
  const author = noteAuthorCard(shown);

  /*
   * `NOTE_GONE` and a dead connection are two different answers and get two different
   * treatments. A transport failure means the server said nothing at all, and announcing
   * anything about the note would turn a tunnel into a deletion.
   *
   * ⚠ **Gone is very nearly unreachable here, and the line is written for what it would
   * actually mean.** Notes have no take-down: nothing archives one, nothing deletes one,
   * and visibility never narrows, because `app.visible_notes` gates on `recipient_id` and
   * that does not change. So this fires only if the note was never this viewer's to begin
   * with — a stale cache, a shared link, a hand-edited id — and the honest sentence is
   * that it is not on their board, not that it was removed from it.
   */
  const gone = applicationErrorCode(detail.error) === 'NOTE_GONE';

  const pinBack = describeNotePinBack(shown, graph.data?.people);

  return (
    <>
      {/*
       * Decorative: everything it does, the CLOSE control also does, and Escape does
       * again. It is hidden from assistive technology rather than announced as a second
       * unlabelled way to leave.
       */}
      <div
        className="note-detail-sheet__scrim"
        aria-hidden="true"
        onClick={() => {
          onClose();
        }}
      />

      <section
        className="note-detail-sheet"
        data-testid="note-detail-sheet"
        ref={sheetRef}
        /*
         * `role="dialog"` without `aria-modal`, as `bulletin-detail-sheet.tsx` explains at
         * length: the sheet is visually modal but nothing behind it is `inert`, and
         * claiming modality would describe a trap this does not build.
         */
        role="dialog"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        {/*
         * ⚠ **The dialog's name, and the only part of this sheet written for ears alone.**
         * Every other sheet on the board names itself with something on screen, because
         * every other sheet has a title to name itself with. A note has none, so the name
         * is built (`note-sheet-title.ts`) — and it is `sr-only` rather than rendered
         * because the thing it says is the note, which is directly below it.
         */}
        <h2 className="sr-only" id={titleId}>
          {noteSheetTitle(shown)}
        </h2>

        <div className="note-detail-sheet__header">
          <span className="note-detail-sheet__type">Note</span>

          {/* The comp's pill, as the card carries it. A note is always private, so it
              always says so — here as much as on the card it was opened from. */}
          <span className="note-detail-sheet__private">Private</span>

          {age === null ? null : <span className="note-detail-sheet__time">{age}</span>}

          <button
            className="note-detail-sheet__close"
            data-testid="note-detail-close-button"
            type="button"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <p className="note-detail-sheet__body">{shown.body}</p>

        {gone ? (
          <p className="note-detail-sheet__gone" data-testid="note-detail-gone">
            This note is not on your board. You are reading the copy you already had.
          </p>
        ) : null}

        {/*
         * The author line, or nothing — never a placeholder, and never "You". Unlike a
         * bulletin, a note is never one you wrote: `app.visible_notes` gates on
         * `recipient_id = viewer_id`, so the only person who can be reading this is the
         * one it was left with.
         */}
        {author === null ? null : (
          <p className="note-detail-sheet__author">
            <PersonIdentity identity={author} />
          </p>
        )}

        {/*
         * ⚠ **Nothing to answer means nothing offered.** When the server refuses the read,
         * the sheet has just said this note is not on your board — and offering to write
         * back to its author in the next breath contradicts the sentence above it. The
         * offer is not wrong so much as incoherent: what is on screen is the viewer's own
         * stale copy, and the author card it would address came out of that same copy.
         *
         * The refusal is deliberately not narrowed further. `NOTE_GONE` is one answer for
         * two situations by design (`note.errors.ts`) — no such note, or somebody else's —
         * so the screen cannot tell which, and a control that assumes the friendlier of
         * the two is the screen guessing.
         */}
        {gone ? null : <PinBackFooter pinBack={pinBack} />}
      </section>
    </>
  );
}

/**
 * The way to answer a note, in each of the states there is one for.
 *
 * A `Link` rather than a button with a handler, matching the bulletin sheet's pin control:
 * it is a *navigation* to the compose screen, exactly as the shell's FAB is, which also
 * means a middle-click opens it in a new tab instead of being silently swallowed.
 *
 * ⚠ **Neither silence is an error state.** `no-author` and `unknown-distance` both render
 * nothing, and they render nothing for different reasons the type keeps apart — there is
 * nobody to write to, versus nobody whose distance is known. Collapsing them into one
 * branch is how a graph read that has not landed turns into a claim that somebody's friend
 * is out of reach.
 */
function PinBackFooter({ pinBack }: { readonly pinBack: NotePinBack }): JSX.Element | null {
  if (pinBack.kind === 'can-pin') {
    return (
      <Link
        className="note-detail-sheet__pin-back"
        data-testid="note-detail-pin-back-link"
        to={pinNoteHref(pinBack.recipientId)}
      >
        {pinBack.label}
      </Link>
    );
  }

  if (pinBack.kind === 'out-of-reach') {
    return (
      <p className="note-detail-sheet__hint" data-testid="note-detail-pin-back-hint">
        {pinBack.hint}
      </p>
    );
  }

  return null;
}

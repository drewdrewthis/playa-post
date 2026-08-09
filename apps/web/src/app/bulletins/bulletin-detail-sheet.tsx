import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type JSX, type PointerEvent } from 'react';
import { Link } from 'react-router';

import { useApi } from '../api/api-provider';
import { applicationErrorCode } from '../api/client';
import { GRAPH_LIST_QUERY_KEY } from '../graph/graph-query-keys';
import { describeNoteReach, type NoteReach } from '../notes/note-reach';
import { PersonIdentity } from '../people/person-identity';

import type { BoardCardView } from './board-card-view';
import { relativeTime, timeUntil } from './relative-time';

import './detail-sheet.css';

/** How far the sheet has to be dragged down before letting go dismisses it. */
const DISMISS_DRAG_DISTANCE = 80;

/**
 * One bulletin in full: the comp's bottom sheet (issue #47).
 *
 * The card is a headline; this is the text. It reads `bulletins.getById` — the server's
 * authoritative copy, re-checked against this viewer's visibility at the moment they
 * open it — and falls back to the card the sheet was opened from while that is in
 * flight or when the network is gone. The fallback is not a placeholder: it is the same
 * bulletin, from the read this board was already built out of, so an author can still
 * open their own post with the radio off.
 *
 * Four ways out, because a sheet that traps someone is worse than no sheet: the CLOSE
 * control, Escape, a tap on the scrim, and a drag downwards.
 *
 * **Pin-a-note is here; Request-intro is still not.** This is the comp's signature "reach
 * someone" gesture, and #88 gave it a server concept: `notes.pin`, gated on a first-degree
 * connection. The comp's condition is a degree test (`deg === 1`) and `BulletinAuthor`
 * carries a disclosure rather than a distance, so the degree is read from `graph.list` —
 * the payload that does carry one, and which the app is usually already holding.
 * Requesting an intro is issue #89 and has no procedure behind it, so the second-degree
 * case is the comp's hint and no button.
 *
 * ⚠ **The degree read here decides what is *offered*, never what is *allowed*.** The
 * authorization lives inside the insert statement (`postgres-note.repository.ts`), which
 * refuses a non-first-degree recipient identically to one who does not exist. A person
 * whose degree changes between this read and the write still gets the server's answer,
 * rendered by the compose screen.
 */
export function BulletinDetailSheet({
  card,
  now,
  onClose,
  onArchive,
  onDismiss,
  onReport,
}: {
  readonly card: BoardCardView;
  readonly now: Date;
  readonly onClose: () => void;
  readonly onArchive: (card: BoardCardView) => void;
  readonly onDismiss: (card: BoardCardView) => void;
  readonly onReport: (card: BoardCardView) => void;
}): JSX.Element {
  const api = useApi();
  const titleId = useId();
  const sheetRef = useRef<HTMLElement>(null);
  const dragOrigin = useRef<number | null>(null);
  const [dragOffset, setDragOffset] = useState(0);

  const detail = useQuery({
    queryKey: ['bulletins', 'getById', card.id],
    queryFn: () => api.query('bulletins.getById', { bulletinId: card.id }),
  });

  /*
   * The same key the graph screen reads under, so opening a sheet after visiting the
   * graph costs nothing. `BulletinAuthor` carries no degree; this is the only payload
   * that does.
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

  const bulletin = detail.data ?? card;
  const age = relativeTime(bulletin.createdAt, now);
  const expiry = bulletin.expiresAt === null ? null : timeUntil(bulletin.expiresAt, now);
  const author = detail.data?.author ?? card.author;

  /*
   * `BULLETIN_GONE` and a dead connection are two different answers and get two
   * different treatments. Gone means archived, dismissed, or no longer reachable, and
   * the copy on screen is genuinely stale — say so. A transport failure means the
   * server said nothing at all, and announcing "no longer on your board" would turn a
   * tunnel into a deletion.
   */
  const gone = applicationErrorCode(detail.error) === 'BULLETIN_GONE';

  const authorLine =
    author === undefined ? (card.own ? 'You' : null) : <PersonIdentity identity={author} />;

  /*
   * Whether to offer pinning a note back, and to whom.
   *
   * `null` while the graph read is unsettled, and for one's own post. A pending read
   * rendering as "not connected" would flash the intro hint at somebody who is in fact a
   * direct connection — the same four-states discipline `people/person-sheet.tsx` keeps.
   */
  const people = graph.data?.people;
  const noteAffordance =
    card.own || author === undefined || people === undefined
      ? null
      : {
          recipientId: author.userId,
          reach: describeNoteReach(people.find((person) => person.userId === author.userId)),
        };

  function endDrag(): void {
    if (dragOrigin.current === null) {
      return;
    }

    dragOrigin.current = null;

    if (dragOffset > DISMISS_DRAG_DISTANCE) {
      onClose();
      return;
    }

    setDragOffset(0);
  }

  return (
    <>
      {/*
       * Decorative: everything it does, the CLOSE control also does, and Escape does
       * again. It is hidden from assistive technology rather than announced as a second
       * unlabelled way to leave.
       */}
      <div
        className="detail-sheet__scrim"
        aria-hidden="true"
        onClick={() => {
          onClose();
        }}
      />

      <section
        className="detail-sheet"
        data-testid="bulletin-detail-sheet"
        data-type={bulletin.type}
        ref={sheetRef}
        /*
         * `role="dialog"` without `aria-modal`. The sheet is visually modal — the scrim
         * covers the column — but nothing behind it is actually `inert`, and claiming
         * modality would tell a screen reader the rest of the page is unreachable when
         * it is still in the tab order. Focus moves in on open and Escape leaves;
         * saying more than that would be a description of a trap this does not build.
         */
        role="dialog"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={dragOffset === 0 ? undefined : { transform: `translateY(${String(dragOffset)}px)` }}
      >
        <div
          className="detail-sheet__grabber"
          aria-hidden="true"
          onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
            dragOrigin.current = event.clientY;
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event: PointerEvent<HTMLDivElement>) => {
            if (dragOrigin.current !== null) {
              // Downwards only: an upwards drag on a bottom sheet has nowhere to go.
              setDragOffset(Math.max(0, event.clientY - dragOrigin.current));
            }
          }}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        />

        <div className="detail-sheet__header">
          <span className="detail-sheet__type">{bulletin.type}</span>
          {age === null ? null : <span className="detail-sheet__time">{age}</span>}

          <button
            className="detail-sheet__close"
            data-testid="bulletin-detail-close-button"
            type="button"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <h2 className="detail-sheet__title" id={titleId}>
          {bulletin.title}
        </h2>

        {/* ⚠ No location renders no line. Never a placeholder, never a guess. */}
        {bulletin.loc === null ? null : <p className="detail-sheet__loc">◦ {bulletin.loc}</p>}

        <p className="detail-sheet__body">{bulletin.body}</p>

        {expiry === null ? null : (
          <p className="detail-sheet__expiry">Expires in {expiry}</p>
        )}

        {gone ? (
          <p className="detail-sheet__gone">
            This bulletin is no longer on your board. You are reading the copy you
            already had.
          </p>
        ) : null}

        {/*
         * The author line, or nothing. `listMine` carries no author card — an author
         * reading their own post is the one case where the §6a projection has nothing
         * to say — so an own bulletin with no card resolves to "You" rather than to a
         * blank line. Anyone else's renders through `PersonIdentity`, which is the one
         * place the withheld case is handled.
         */}
        {authorLine === null ? null : (
          <p className="detail-sheet__author">{authorLine}</p>
        )}

        <div className="detail-sheet__actions">
          {card.own ? (
            <button
              className="button button--danger"
              data-testid="bulletin-archive-button"
              type="button"
              disabled={card.archived}
              onClick={() => {
                onArchive(card);
              }}
            >
              {/* "Archive", not the comp's "Delete post": the server soft-deletes, the
                  bulletin stays on its author's own list, and a button that said delete
                  would promise an erasure that did not happen. */}
              Archive post
            </button>
          ) : (
            <>
              <button
                className="button"
                data-testid="bulletin-dismiss-button"
                type="button"
                onClick={() => {
                  onDismiss(card);
                }}
              >
                Dismiss
              </button>

              {/*
               * ⚠ Dismiss acts; report *asks*. `onReport` opens the report sheet
               * (`moderation/report-abuse-sheet.tsx`), which collects what kind of abuse
               * this is and what happened — a report is a claim the stewards act on, and
               * one filed by a single tap carries nothing for them to act on. Nothing is
               * sent from this button.
               */}
              <button
                className="button button--danger"
                data-testid="bulletin-report-button"
                type="button"
                onClick={() => {
                  onReport(card);
                }}
              >
                Report abuse
              </button>
            </>
          )}
        </div>

        {noteAffordance === null ? null : (
          <PinNoteFooter
            recipientId={noteAffordance.recipientId}
            reach={noteAffordance.reach}
          />
        )}
      </section>
    </>
  );
}

/**
 * The comp's footer for reaching the author: a button when you may, one line when you
 * may not (`design/Playa Post.dc.html:285,745-746`).
 *
 * A `Link` rather than a button with a handler, because pinning is a *navigation* — the
 * compose sheet is the `/board/new` route, exactly as the shell's FAB reaches it. That
 * also means it opens in a new tab if somebody middle-clicks, which a handler would
 * silently swallow.
 */
function PinNoteFooter({
  recipientId,
  reach,
}: {
  readonly recipientId: string;
  readonly reach: NoteReach;
}): JSX.Element {
  if (reach.kind === 'can-pin') {
    return (
      <Link
        className="button button--primary detail-sheet__pin-note"
        data-testid="bulletin-detail-pin-note-link"
        to={`/board/new?noteTo=${encodeURIComponent(recipientId)}`}
      >
        {reach.label}
      </Link>
    );
  }

  return (
    <p className="detail-sheet__intro-hint" data-testid="bulletin-detail-intro-hint">
      {reach.hint}
    </p>
  );
}

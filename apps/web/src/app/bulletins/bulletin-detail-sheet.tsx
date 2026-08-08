import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type JSX, type PointerEvent } from 'react';

import { useApi } from '../api/api-provider';
import { applicationErrorCode } from '../api/client';
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
 * **Pin-a-note and Request-intro are deliberately absent.** The comp puts both here and
 * they are its signature "reach someone" gestures, but there is no server concept of
 * either, *and* their comp conditions are degree tests (`deg === 1`, `deg === 2`) this
 * client cannot evaluate — `BulletinAuthor` carries a disclosure, not a distance. A
 * disabled button would advertise a control whose enabling condition cannot even be
 * computed, so the sheet says plainly that replying is not built instead.
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

        {card.own ? null : (
          <p className="detail-sheet__unbuilt">
            There is no way to reply yet — pinning a note to someone&rsquo;s board
            arrives in a later release.
          </p>
        )}
      </section>
    </>
  );
}

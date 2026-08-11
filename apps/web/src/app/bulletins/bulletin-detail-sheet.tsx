import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type JSX, type PointerEvent } from 'react';
import { Link } from 'react-router';

import { useApi } from '../api/api-provider';
import { applicationErrorCode } from '../api/client';
import { GRAPH_LIST_QUERY_KEY } from '../graph/graph-query-keys';
import { describeIntroStanding, type IntroStanding } from '../intros/intro-outbox-state';
import { INTRO_OUTBOX_QUERY_KEY } from '../intros/intro-query-keys';
import { IntroSheet } from '../intros/intro-sheet';
import { describeNoteReach, type NoteReach } from '../notes/note-reach';
import { noteRecipientName, pinNoteHref } from '../notes/note-recipient';
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
 * **Both ways of reaching the author are here.** This is the comp's signature "reach
 * someone" gesture: #88 gave the first degree a server concept (`notes.pin`) and #89 gave
 * the second one its own (`intros.request`). The comp's condition is a degree test
 * (`deg === 1`) and `BulletinAuthor` carries a disclosure rather than a distance, so the
 * degree is read from `graph.list` — the payload that does carry one, and which the app
 * is usually already holding. Past the second degree there is a hint and no control,
 * because an intro travels one hop.
 *
 * ⚠ **The degree read here decides what is *offered*, never what is *allowed*.** The
 * authorization lives inside the statements — `postgres-note.repository.ts`'s insert, and
 * `app.intro_via_candidates` behind `intros.request` — each refusing an ineligible person
 * identically to one who does not exist. A person whose degree changes between this read
 * and the write still gets the server's answer, rendered by the screen that asked.
 */
export function BulletinDetailSheet({
  card,
  now,
  onClose,
  onArchive,
  onDismiss,
  onReport,
  onUndismiss,
}: {
  readonly card: BoardCardView;
  readonly now: Date;
  readonly onClose: () => void;
  readonly onArchive: (card: BoardCardView) => void;
  /**
   * Take it off my board. Absent in the Dismissed category, where it is already off.
   *
   * ⚠ **Optional together with {@link onReport}, and mutually exclusive with
   * {@link onUndismiss}** — the caller passes one direction or the other, never both.
   * Offering both would let somebody dismiss what is already dismissed: the server
   * converges on that, so nothing would appear to happen, which reads as a broken button.
   */
  readonly onDismiss?: (card: BoardCardView) => void;
  readonly onReport?: (card: BoardCardView) => void;
  /**
   * Put it back on my board (#170) — the Dismissed category's way out.
   *
   * ⚠ **Its presence is what tells this sheet it is being opened from that category**, so
   * it outranks every other action here, including an author's own Remove: a viewer may
   * dismiss their own post, and one opened from the Dismissed category still needs the way
   * back rather than a second way out.
   *
   * ⚠ **There is deliberately no un-report beside it.** Reporting says something about
   * the bulletin that the stewards act on; withdrawing that is a different decision the
   * server does not offer (M5). A viewer who both reported and dismissed something can
   * un-dismiss it and will still not see it, which is correct — and is why this sheet
   * never claims the bulletin is coming back, only that it is no longer dismissed.
   */
  readonly onUndismiss?: (card: BoardCardView) => void;
}): JSX.Element {
  const api = useApi();
  const titleId = useId();
  const sheetRef = useRef<HTMLElement>(null);
  const dragOrigin = useRef<number | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [askingIntro, setAskingIntro] = useState(false);

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

  /*
   * The viewer's own outbox, under the one shared key `people/person-sheet.tsx` reads
   * and the intro sheet invalidates. While a request for this pair is open the server
   * refuses a second one with any via, so without this read the footer would offer a
   * button whose only outcome is `INTRO_UNAVAILABLE`.
   */
  const outbox = useQuery({
    queryKey: INTRO_OUTBOX_QUERY_KEY,
    queryFn: () => api.query('intros.listOutbox', undefined),
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
   * Whether to offer reaching the author, how, and to whom.
   *
   * `null` while the graph read is unsettled, and for one's own post. A pending read
   * rendering as "not connected" would flash the intro control at somebody who is in fact
   * a direct connection — the same four-states discipline `people/person-sheet.tsx` keeps.
   *
   * `recipientName` is what §6a lets this viewer call them, or `null`; the intro sheet
   * needs it for its own heading and must never derive one from the id.
   */
  const people = graph.data?.people;
  const authorPerson =
    author === undefined || people === undefined
      ? undefined
      : people.find((person) => person.userId === author.userId);
  const noteAffordance =
    card.own || author === undefined || people === undefined
      ? null
      : {
          recipientId: author.userId,
          recipientName: noteRecipientName(authorPerson),
          reach: describeNoteReach(authorPerson),
        };

  /*
   * `null` until the outbox read settles — and it stays `null` if that read fails,
   * matching `person-sheet.tsx`'s four-states discipline: silence is the honest answer
   * when the record cannot be read, and the pessimistic direction never offers a button
   * the server would refuse.
   */
  const standing =
    noteAffordance === null || outbox.data === undefined
      ? null
      : describeIntroStanding(outbox.data, noteAffordance.recipientId);

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

        {/*
         * ⚠ Above the moderation row, which is where the comp puts it
         * (`design/Playa Post.dc.html:285` — the `canNote` block precedes `canModerate`).
         * Reaching somebody is the sheet's positive action and Dismiss/Report are its
         * escape hatches; under them, the first full-width control below a stranger's post
         * is the one that makes them go away.
         */}
        {noteAffordance === null ? null : (
          <PinNoteFooter
            recipientId={noteAffordance.recipientId}
            reach={noteAffordance.reach}
            standing={standing}
            onRequestIntro={() => {
              setAskingIntro(true);
            }}
          />
        )}

        <div className="detail-sheet__actions">
          {onUndismiss !== undefined ? (
            /*
             * The Dismissed category's one action (#170).
             *
             * ⚠ **Ahead of the author's own Remove, deliberately.** A viewer may dismiss
             * their own post, so an own bulletin reaches this sheet from the Dismissed
             * category too — and there the only thing to offer is the way out of the
             * category. Removing a post one is not currently being shown is a board
             * action, and putting it back is what gets somebody to the board.
             *
             * ⚠ **"Put back on my board", not "Undo".** Undo describes the gesture; this
             * describes the outcome, and the outcome is the part a person is deciding
             * about. It is also the honest wording for a viewer who also reported the
             * bulletin: the dismissal really is withdrawn, whether or not the card
             * reappears.
             *
             * No Report beside it. Somebody looking at their own dismissals is tidying,
             * not moderating, and a report filed from here would be one filed without the
             * sheet that asks what happened.
             */
            <button
              className="button"
              data-testid="bulletin-undismiss-button"
              type="button"
              onClick={() => {
                onUndismiss(card);
              }}
            >
              Put back on my board
            </button>
          ) : card.own ? (
            <button
              className="button button--danger"
              data-testid="bulletin-archive-button"
              type="button"
              disabled={card.archived}
              onClick={() => {
                onArchive(card);
              }}
            >
              {/* "Remove", not the comp's "Delete post": the server soft-deletes, the
                  bulletin stays on its author's own list, and a button that said delete
                  would promise an erasure that did not happen. */}
              Remove post
            </button>
          ) : (
            <>
              {onDismiss === undefined ? null : (
                <button
                  className="button"
                  data-testid="bulletin-dismiss-button"
                  type="button"
                  onClick={() => {
                    onDismiss(card);
                  }}
                >
                  {/* Not "Remove" — that is the author's word for their own post, and
                      dismissing removes nothing. It moves the bulletin to this viewer's
                      Dismissed category, where `onUndismiss` above brings it back. */}
                  Dismiss
                </button>
              )}

              {/*
               * ⚠ Dismiss acts; report *asks*. `onReport` opens the report sheet
               * (`moderation/report-abuse-sheet.tsx`), which collects what kind of abuse
               * this is and what happened — a report is a claim the stewards act on, and
               * one filed by a single tap carries nothing for them to act on. Nothing is
               * sent from this button.
               */}
              {onReport === undefined ? null : (
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
              )}
            </>
          )}
        </div>
      </section>

      {/*
       * ⚠ A sibling of the sheet, never a child of it. Both the intro sheet and its scrim
       * are `position: absolute` against `.app-column`; rendered inside `.detail-sheet`
       * — which is itself positioned — they would resolve against *it* instead, and a
       * full-column scrim would become a rectangle inside the sheet it is meant to cover.
       */}
      {noteAffordance !== null && askingIntro ? (
        <IntroSheet
          targetUserId={noteAffordance.recipientId}
          targetName={noteAffordance.recipientName}
          onClose={() => {
            setAskingIntro(false);
          }}
        />
      ) : null}
    </>
  );
}

/**
 * The comp's control for reaching the author, in each of its three distances
 * (`design/Playa Post.dc.html:285,745-746`).
 *
 * Pinning is a `Link` rather than a button with a handler, because it is a *navigation* —
 * the compose sheet is the `/board/new` route, exactly as the shell's FAB reaches it. That
 * also means it opens in a new tab if somebody middle-clicks, which a handler would
 * silently swallow. Asking for an intro is the opposite: a sheet over this one, so it is
 * a button, and closing it leaves the reader on the bulletin they were reading.
 *
 * ⚠ **Neither is `button--primary`.** The comp fills the pin control with ink and sets
 * its label in paper (`background:t.ink;color:t.bgSolid`), and it is right to: the orange
 * fill is the FAB's, which means "compose", and it belongs to one thing. The intro
 * control takes the accent outline instead — a different gesture, told apart at a glance
 * from the one that writes to somebody's board.
 */
function PinNoteFooter({
  recipientId,
  reach,
  standing,
  onRequestIntro,
}: {
  readonly recipientId: string;
  readonly reach: NoteReach;
  readonly standing: IntroStanding | null;
  readonly onRequestIntro: () => void;
}): JSX.Element {
  if (reach.kind === 'can-pin') {
    return (
      <Link
        className="detail-sheet__pin-note"
        data-testid="bulletin-detail-pin-note-link"
        to={pinNoteHref(recipientId)}
      >
        {reach.label}
      </Link>
    );
  }

  if (reach.kind === 'can-request-intro') {
    /*
     * What already happened outranks what could happen — `person-sheet.tsx`'s
     * `PersonActions` order. An unsettled outbox renders the hint and no control
     * (offering "ask" before the record is read risks a button whose only outcome is
     * `INTRO_UNAVAILABLE`); an open or passed-on ask renders its standing line and
     * nothing to press.
     *
     * ⚠ A *declined* ask keeps the control here, unlike the person sheet. A decline
     * leaves the pair free to ask again (the partial unique index covers open requests
     * only), and this bulletin is a fresh reason to — but the "not passed on" line
     * stays off this surface, because a re-ask control rendered *beside* that line
     * would turn one person's decision into a prompt to overturn it. The person sheet
     * reports the outcome; this sheet offers the new ask.
     */
    const showStandingLine =
      standing !== null && (standing.kind === 'pending' || standing.kind === 'passed-on');
    const showAskControl =
      standing !== null && (standing.kind === 'none' || standing.kind === 'declined');

    return (
      <div className="detail-sheet__intro">
        <p className="detail-sheet__intro-hint" data-testid="bulletin-detail-intro-hint">
          {reach.hint}
        </p>

        {showStandingLine ? (
          <p
            className="detail-sheet__intro-standing"
            role="status"
            data-testid="bulletin-detail-intro-standing"
          >
            {standing.line}
          </p>
        ) : null}

        {showAskControl ? (
          <button
            className="detail-sheet__request-intro"
            data-testid="bulletin-detail-request-intro-button"
            type="button"
            onClick={onRequestIntro}
          >
            {reach.label}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <p className="detail-sheet__intro-hint" data-testid="bulletin-detail-intro-hint">
      {reach.hint}
    </p>
  );
}

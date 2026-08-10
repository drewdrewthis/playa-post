import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type JSX } from 'react';

import type { Person } from '@playa-post/contracts';

import { useApi } from '../api/api-provider';
import { GRAPH_LIST_QUERY_KEY } from '../graph/graph-query-keys';
import { describeIntroStanding, type IntroStanding } from '../intros/intro-outbox-state';
import { INTRO_OUTBOX_QUERY_KEY } from '../intros/intro-query-keys';
import { IntroSheet } from '../intros/intro-sheet';
import { describeNoteReach, type NoteReach } from '../notes/note-reach';
import { noteRecipientName } from '../notes/note-recipient';

import { PersonIdentity, trustLabel } from './person-identity';

import './person-sheet.css';

const TRUST_MIN = 0;
const TRUST_MAX = 100;

/**
 * One person, and the viewer's private directional trust in them — as the comp's
 * bottom sheet over the graph (`design/Playa Post.dc.html`, the `hasSel` block), not a
 * destination. Tapping a node is *selection*: the graph stays mounted behind the scrim,
 * and every way out of the sheet — CLOSE, Escape, the scrim — puts the viewer exactly
 * where they already were.
 *
 * ⚠ **Trust is the viewer's own value and belongs to nobody else.** The server returns
 * `null` for a connection the viewer does not hold (B6), so this sheet never has
 * another party's number to render even by accident. The slider is shown only when
 * there is a connection to hold an opinion about.
 *
 * `null` and `0` are two states. The slider's position for an unset value is the
 * minimum, but the label says *Not set* until the viewer saves — otherwise a user who
 * never expressed an opinion would be shown, and would eventually save, a zero they
 * never chose.
 *
 * **The intro affordance lives here too** (#89): at the second degree this is the screen
 * somebody is looking at when they want to reach a person they cannot write to. What it
 * offers is decided by two reads together — the degree, from the graph payload the sheet
 * was opened with, and the viewer's own outbox, because while a request for this pair is
 * open the server refuses a second one with any via. Offering the control anyway would
 * be offering a button whose only outcome is `INTRO_UNAVAILABLE`.
 */
export function PersonSheet({
  person,
  onClose,
}: {
  readonly person: Person;
  readonly onClose: () => void;
}): JSX.Element {
  const api = useApi();
  const queryClient = useQueryClient();
  const titleId = useId();
  const sheetRef = useRef<HTMLElement>(null);
  const otherUserId = person.userId;

  const connectionKey = ['connection', otherUserId] as const;
  const connection = useQuery({
    queryKey: connectionKey,
    queryFn: () => api.query('connections.connection.get', { otherUserId }),
  });

  /*
   * The whole outbox, not this person's slice: there is one `intros.listOutbox` cache
   * entry, the intro sheet invalidates it after a send, and every open person sheet reads
   * its answer out of the same place.
   */
  const outbox = useQuery({
    queryKey: INTRO_OUTBOX_QUERY_KEY,
    queryFn: () => api.query('intros.listOutbox', undefined),
  });

  const [askingIntro, setAskingIntro] = useState(false);
  const [draftTrust, setDraftTrust] = useState<number | null>(null);
  const savedTrust = connection.data?.trust ?? null;

  useEffect(() => {
    setDraftTrust(savedTrust);
  }, [savedTrust]);

  const saveTrust = useMutation({
    mutationFn: (trust: number) =>
      api.mutate('connections.trust.set', { subjectUserId: otherUserId, trust }),
    onSuccess: async () => {
      /*
       * The saved value feeds two views: this sheet's own connection query, and the
       * graph screen's TRUSTED count. Invalidate those, not the world — an unkeyed
       * invalidation refetches every query in the app because one slider was saved.
       */
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: connectionKey }),
        queryClient.invalidateQueries({ queryKey: GRAPH_LIST_QUERY_KEY }),
      ]);
    },
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
  // Escape reaches this handler rather than the node they came from. On close, focus
  // returns to that node — an SVG circle, hence the SVGElement arm — so closing the
  // sheet does not dump a keyboard user at the top of the document.
  useEffect(() => {
    const opener = document.activeElement;
    sheetRef.current?.focus();

    return () => {
      if (opener instanceof HTMLElement || opener instanceof SVGElement) {
        opener.focus();
      }
    };
  }, []);

  const targetName = noteRecipientName(person);
  const reach = describeNoteReach(person);

  /*
   * `null` until the outbox read settles — and it stays `null` if that read fails, which
   * is deliberate. The affordance this block chooses between is "ask" and "you already
   * asked", and getting that wrong in the optimistic direction offers a button the server
   * will refuse. Silence is the honest answer when the record cannot be read.
   */
  const standing = outbox.data === undefined ? null : describeIntroStanding(outbox.data, otherUserId);

  return (
    <>
      {/*
       * Decorative: everything it does, the CLOSE control also does, and Escape does
       * again. It is hidden from assistive technology rather than announced as a second
       * unlabelled way to leave.
       */}
      <div
        className="person-sheet__scrim"
        aria-hidden="true"
        onClick={() => {
          onClose();
        }}
      />

      <section
        className="person-sheet"
        data-testid="person-sheet"
        ref={sheetRef}
        /*
         * `role="dialog"` without `aria-modal`, for `bulletin-detail-sheet.tsx`'s
         * reason: nothing behind the scrim is actually `inert`, and claiming modality
         * would describe a trap this does not build.
         */
        role="dialog"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="person-sheet__header">
          <h2 className="person-sheet__title" id={titleId}>
            <PersonIdentity identity={person} />
          </h2>

          <button
            className="person-sheet__close"
            data-testid="person-sheet-close-button"
            type="button"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        {/*
         * Four states, told apart on purpose: a query still in flight or failed must
         * not read as "not connected" — that message is the server's resolved `null`
         * (B6) and nothing else.
         */}
        {connection.isPending ? (
          // `role="status"`: the sheet has already taken focus, so without a live
          // region a screen-reader user hears the title and then silence while the
          // content swaps in. The error arm keeps `role="alert"`'s higher urgency.
          <p className="person-sheet__notice" role="status">
            Loading&hellip;
          </p>
        ) : connection.isError ? (
          <p className="person-sheet__notice" role="alert">
            That did not load. Close the sheet and try again.
          </p>
        ) : connection.data === null ? (
          <p className="person-sheet__notice">
            {/* The comp's "connect first to set trust": a tappable node past the first
                degree is somebody the viewer can see, not somebody they hold trust in. */}
            You are not connected to this person, so there is nothing to set.
          </p>
        ) : (
          <>
            <p className="person-sheet__lede">
              Trust is private and one-directional. They never see it, and neither does
              anyone else.
            </p>

            <p className="person-sheet__trust-value" data-testid="person-sheet-trust-value">
              Your trust: {trustLabel(draftTrust)}
            </p>

            <label className="form__field">
              <span className="form__label">Trust</span>
              <input
                className="form__slider"
                type="range"
                aria-label="Trust"
                min={TRUST_MIN}
                max={TRUST_MAX}
                value={draftTrust ?? TRUST_MIN}
                onChange={(event) => setDraftTrust(Number(event.target.value))}
              />
            </label>

            <button
              className="button button--primary"
              data-testid="person-sheet-save-trust-button"
              type="button"
              disabled={draftTrust === null || saveTrust.isPending}
              onClick={() => {
                if (draftTrust !== null) {
                  saveTrust.mutate(draftTrust);
                }
              }}
            >
              Save trust
            </button>
          </>
        )}

        {saveTrust.error === null ? null : (
          <p className="form__error" role="alert">
            That did not save. Try again.
          </p>
        )}

        <IntroAffordance
          standing={standing}
          reach={reach}
          degree={person.degree}
          onRequestIntro={() => {
            setAskingIntro(true);
          }}
        />
      </section>

      {/*
       * ⚠ A sibling of the sheet, never a child of it — `bulletin-detail-sheet.tsx`
       * records the reason: both the intro sheet and its scrim are `position: absolute`
       * against `.app-column`, and nesting them inside a positioned sheet would resolve
       * them against it instead.
       */}
      {askingIntro ? (
        <IntroSheet
          targetUserId={otherUserId}
          targetName={targetName}
          onClose={() => {
            setAskingIntro(false);
          }}
        />
      ) : null}
    </>
  );
}

/**
 * What this sheet says about an introduction: an offer, a state, a hint, or nothing.
 *
 * The order is the point. **What already happened outranks what could happen** — a
 * requester with an open ask is told about it rather than invited to make a second one,
 * and a requester who was declined is told that and given *nothing to press*. A re-ask
 * control beside "not passed on" would turn one person's decision into a prompt to
 * overturn it, and the wire deliberately carries no reason to argue with.
 *
 * ⚠ **Past the second degree there is a hint and no control**, because
 * `app.intro_via_candidates` returns nobody there: an intro travels one hop.
 *
 * @param standing - the settled outbox reading, or `null` while it is not settled.
 * @param degree - this person's distance, which decides whether an intro is possible at
 *   all. Read from the graph payload the sheet was opened with, never from the outbox.
 */
function IntroAffordance({
  standing,
  reach,
  degree,
  onRequestIntro,
}: {
  readonly standing: IntroStanding | null;
  readonly reach: NoteReach;
  readonly degree: number;
  readonly onRequestIntro: () => void;
}): JSX.Element | null {
  if (standing === null) {
    return null;
  }

  if (standing.kind !== 'none') {
    return (
      <p className="person-sheet__intro-standing" data-testid="person-sheet-intro-standing">
        {standing.line}
      </p>
    );
  }

  if (reach.kind === 'can-request-intro') {
    return (
      <button
        className="button button--primary"
        data-testid="person-sheet-request-intro-button"
        type="button"
        onClick={onRequestIntro}
      >
        {reach.label}
      </button>
    );
  }

  /*
   * Only from the third degree out. `describeNoteReach`'s other `needs-connection` hints
   * are about *pinning a note*, and this sheet does not offer that — rendering one here
   * would explain a control that is not on screen.
   */
  if (reach.kind === 'needs-connection' && degree >= 3) {
    return (
      <p className="person-sheet__intro-hint" data-testid="person-sheet-intro-hint">
        {reach.hint}
      </p>
    );
  }

  return null;
}

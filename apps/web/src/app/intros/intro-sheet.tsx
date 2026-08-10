import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type JSX } from 'react';

import type { IntroPerson } from '@playa-post/contracts';

import { useApi } from '../api/api-provider';
import { applicationErrorCode } from '../api/client';
import { PersonIdentity } from '../people/person-identity';

import {
  askViaLabel,
  INTRO_CONSENT_LINE,
  INTRO_NO_CANDIDATES_LINE,
  introPersonName,
  introRefusalMessage,
  introSheetTitle,
} from './intro-copy';
import {
  INTRO_NOTE_MAX_LENGTH,
  inspectIntroNote,
  introNoteOverBy,
} from './intro-note-draft';
import { INTRO_OUTBOX_QUERY_KEY, introViaCandidatesQueryKey } from './intro-query-keys';

import './intro-sheet.css';

/**
 * Ask somebody you both know for an introduction — issue #89, the comp's "request an
 * intro" gesture given a procedure behind it.
 *
 * It is the note sheet's twin by design ("a special type of pinning a note"): one
 * textarea, the same 1–4000 bound, and no other field the writer can get wrong. What it
 * adds is the one choice a note never has — *who to ask* — and the sentence that says
 * what sending means.
 *
 * ⚠ **Online only, and deliberately not queued.** `intros.request` is absent from
 * `QUEUED_MUTATION_TYPES` for `notifications.dismiss`'s reason: eligibility is
 * time-varying (the graph moves, a target lowers their reach setting) and ADR-0005's
 * conflict matrix does not define this type, so a queued envelope would replay as
 * `rejected` / `UNSUPPORTED_MUTATION_TYPE`. Routing it through the queue would look more
 * robust and be strictly less so.
 *
 * ⚠ **Every refusal is one refusal.** The server answers `INTRO_UNAVAILABLE` identically
 * for a target at the wrong distance, a via who does not know them, a person who is not
 * there, and an ask already open — so this sheet renders that sentence and never
 * explains it. Explaining it would rebuild the oracle the server closed.
 *
 * Four ways out, matching every other sheet in this app: the CLOSE control, Escape, the
 * scrim, and sending. There is no drag-to-dismiss — this sheet holds typed text, and a
 * downward swipe on a phone is how somebody scrolls a textarea.
 */
export function IntroSheet({
  targetUserId,
  targetName,
  onClose,
}: {
  readonly targetUserId: string;
  /** What §6a lets this viewer call the target, or `null`. Never a derived placeholder. */
  readonly targetName: string | null;
  readonly onClose: () => void;
}): JSX.Element {
  const api = useApi();
  const queryClient = useQueryClient();
  const titleId = useId();
  const viasId = useId();
  const consentId = useId();
  const lengthId = useId();
  const sheetRef = useRef<HTMLElement>(null);

  const [chosenViaId, setChosenViaId] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const candidatesKey = introViaCandidatesQueryKey(targetUserId);
  const candidates = useQuery({
    queryKey: candidatesKey,
    queryFn: () => api.query('intros.viaCandidates', { targetUserId }),
  });

  const ask = useMutation({
    mutationFn: (viaUserId: string) =>
      api.mutate('intros.request', { targetUserId, viaUserId, note: note.trim() }),
    onSuccess: async () => {
      /*
       * The outbox is what flips the opener's affordance to "Intro pending via {name}" —
       * without this the requester presses send and watches the button they just used
       * stay exactly as it was. The candidate list goes with it because it was read
       * before the send and a cached copy would be re-offered on the next open.
       *
       * Those two keys, not the world: an unkeyed invalidation refetches every query in
       * the app because one intro was sent.
       */
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: INTRO_OUTBOX_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: candidatesKey }),
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
  // Escape reaches this handler rather than the sheet underneath — which has its own,
  // and would close the wrong thing. On close, focus returns to whatever opened it.
  useEffect(() => {
    const opener = document.activeElement;

    sheetRef.current?.focus();

    return () => {
      if (opener instanceof HTMLElement || opener instanceof SVGElement) {
        opener.focus();
      }
    };
  }, []);

  const vias = candidates.data;

  /*
   * One candidate is preselected — there is nothing to choose between, and making
   * somebody tap the only chip on screen is a step that teaches nothing. Derived rather
   * than stored, so a refetch that changes the list cannot leave a selection pointing at
   * a via the server no longer offers.
   */
  const onlyVia = vias !== undefined && vias.length === 1 ? vias[0] : undefined;
  const selectedViaId = chosenViaId ?? onlyVia?.userId ?? null;
  const selectedVia = vias?.find((via) => via.userId === selectedViaId);

  const issues = inspectIntroNote(note);
  const over = issues.note === 'too-long';
  /*
   * ⚠ No via, no send. An empty candidate list can therefore never sit under a live
   * button: there is nothing to preselect and nothing to choose, so `selectedViaId` stays
   * `null` and the control is off — the same expression that keeps it off while a reader
   * with two candidates has not picked one yet.
   */
  const sendable = selectedViaId !== null && issues.sendable && !ask.isPending;

  function send(): void {
    if (!sendable || selectedViaId === null) {
      return;
    }

    ask.mutate(selectedViaId);
  }

  return (
    <>
      {/*
       * Decorative: everything it does, the CLOSE control also does, and Escape does
       * again. It is hidden from assistive technology rather than announced as a second
       * unlabelled way to leave.
       */}
      <div
        className="intro-sheet__scrim"
        aria-hidden="true"
        onClick={() => {
          onClose();
        }}
      />

      <section
        className="intro-sheet"
        data-testid="intro-sheet"
        ref={sheetRef}
        /*
         * `role="dialog"` without `aria-modal`, for `bulletin-detail-sheet.tsx`'s reason:
         * nothing behind the scrim is actually `inert`, and claiming modality would
         * describe a trap this does not build.
         */
        role="dialog"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="intro-sheet__header">
          <h2 className="intro-sheet__title" id={titleId}>
            {introSheetTitle(targetName)}
          </h2>

          <button
            className="intro-sheet__close"
            data-testid="intro-sheet-close-button"
            type="button"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        {ask.isSuccess ? (
          /*
           * The sheet stays open on success rather than closing itself. What just
           * happened is that somebody else now has to decide, and a sheet that vanished
           * would leave that unsaid — the opener's affordance carries it from here on.
           */
          <p className="intro-sheet__notice" data-testid="intro-sheet-sent" role="status">
            Asked. {introPersonName(selectedVia) ?? 'They'} will decide whether to pass it
            on, and you will see the answer here.
          </p>
        ) : (
          <>
            <p className="intro-sheet__consent" id={consentId} data-testid="intro-sheet-consent">
              {INTRO_CONSENT_LINE}
            </p>

            <div className="intro-sheet__vias">
              <p className="intro-sheet__label" id={viasId}>
                Ask via
              </p>

              {/*
               * Four states, told apart on purpose: a read in flight or failed must not
               * read as "nobody can introduce you" — that message is the server's settled
               * empty list and nothing else.
               */}
              {candidates.isPending ? (
                <p className="intro-sheet__notice" role="status">
                  Loading&hellip;
                </p>
              ) : candidates.isError ? (
                <p className="intro-sheet__notice" role="alert">
                  That did not load. Close the sheet and try again.
                </p>
              ) : vias === undefined || vias.length === 0 ? (
                <p
                  className="intro-sheet__notice"
                  data-testid="intro-sheet-no-candidates"
                  role="status"
                >
                  {INTRO_NO_CANDIDATES_LINE}
                </p>
              ) : (
                <div className="intro-sheet__chips" role="group" aria-labelledby={viasId}>
                  {vias.map((via) => (
                    <ViaChip
                      key={via.userId}
                      via={via}
                      chosen={via.userId === selectedViaId}
                      onChoose={() => {
                        setChosenViaId(via.userId);
                      }}
                    />
                  ))}
                </div>
              )}
            </div>

            <label className="intro-sheet__field">
              <span className="intro-sheet__label">Your note</span>

              <textarea
                className="form__input form__input--prose intro-sheet__note"
                data-testid="intro-sheet-note-input"
                rows={3}
                /* No hard `maxLength`: truncating mid-sentence loses what somebody wrote.
                   The line below says it instead, and the server refuses it. */
                value={note}
                placeholder="Why do you want to connect? They’ll see this."
                aria-describedby={over ? `${consentId} ${lengthId}` : consentId}
                aria-invalid={over}
                onChange={(event) => {
                  setNote(event.target.value);
                }}
              />
            </label>

            {over ? (
              <p className="form__error" id={lengthId}>
                {INTRO_NOTE_MAX_LENGTH} characters at most — {introNoteOverBy(note)} over.
              </p>
            ) : null}

            {ask.error === null ? null : (
              <p className="form__error" data-testid="intro-sheet-error" role="alert">
                {introRefusalMessage(applicationErrorCode(ask.error))}
              </p>
            )}

            {/*
             * ⚠ A real `disabled`, unlike `report-abuse-sheet.tsx`'s `aria-disabled`.
             * That sheet keeps its send focusable because the reason it is off is a field
             * the reader can go and fill in; the reason this one is off may be that
             * nobody can make the introduction, which is not a thing to fix from here.
             * The notice above it carries the reason, in a live region, so it is
             * announced rather than left for somebody to find by tabbing.
             */}
            <button
              className="button button--primary intro-sheet__send"
              data-testid="intro-sheet-send-button"
              type="button"
              disabled={!sendable}
              onClick={send}
            >
              {askViaLabel(introPersonName(selectedVia))}
            </button>
          </>
        )}
      </section>
    </>
  );
}

/**
 * One candidate via, as a chip.
 *
 * ⚠ **Nothing on this element carries the candidate's identifier** — not a `data-testid`,
 * not a label, not a title. A `topology_only` via is a chip with no name on it, and an id
 * smuggled into an attribute is that name given back in a form nobody reads but everybody
 * can. {@link PersonIdentity} is the one place the withheld case is rendered.
 */
function ViaChip({
  via,
  chosen,
  onChoose,
}: {
  readonly via: IntroPerson;
  readonly chosen: boolean;
  readonly onChoose: () => void;
}): JSX.Element {
  return (
    <button
      className="intro-sheet__chip"
      data-testid="intro-sheet-via-chip"
      type="button"
      /* The one source of truth for "chosen", exactly as the board's filter chips and the
         report sheet's reasons do it: a chip cannot look selected while announcing it is
         not. */
      aria-pressed={chosen}
      onClick={onChoose}
    >
      <PersonIdentity identity={via} />
    </button>
  );
}

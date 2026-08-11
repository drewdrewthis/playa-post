import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type JSX } from 'react';

import {
  INTRO_DECISION,
  INTRO_INBOX_ROLE,
  INTRO_RESPONSE,
  type DecideIntroRequest,
  type IntroInboxRow,
  type RespondToIntroRequest,
} from '@playa-post/contracts';

import { useApi } from '../api/api-provider';
import { applicationErrorCode } from '../api/client';
import { PersonIdentity, type DisclosableIdentity } from '../people/person-identity';

import {
  INTRO_ACCEPT_LABEL,
  INTRO_ANSWER_LINE,
  INTRO_DECISION_CONFIRMATION_LINE,
  INTRO_RESPONSE_CONFIRMATION_LINE,
  INTRO_TARGET_DECLINE_LABEL,
  INTRO_VIA_NOTE_LINE,
  INTRO_VOUCHED_LINE,
  introPersonName,
  introRefusalMessage,
  PASS_ON_WITH_NOTE_LABEL,
  viaNoteLabel,
} from './intro-copy';
import { INTRO_NOTE_MAX_LENGTH, inspectIntroNote, introNoteOverBy } from './intro-note-draft';
import { INTRO_INBOX_QUERY_KEY } from './intro-query-keys';

import './intro-inbox.css';

/**
 * What to render where a person card should be but is not.
 *
 * A request outlives the relationship that carried it, so the wire omits a card the
 * viewer may no longer be shown. {@link PersonIdentity}'s withheld treatment is the one
 * implementation of "render no name at all" — reaching for it here, rather than writing a
 * placeholder of this file's own, is what keeps §6a spelled one way.
 */
const WITHHELD: DisclosableIdentity = { disclosure: 'topology_only' };

/**
 * Intros waiting on this viewer, at the top of their graph.
 *
 * ⚠ **This is the authoritative surface for an intro request, and the notifications
 * contract is deliberately untouched** (#89, §4): a notification is a thing you read and
 * dismiss, which is the wrong shape for a request one person has to *decide*. (#149 has
 * since given `GroupedNotification` a `kind` discriminator, so a third kind is now
 * cheap — that changes what it would cost, not what it would mean.) The bell may one day
 * count these; it will do it by reading `intros.listInbox` alongside its own query,
 * additively.
 *
 * It lives on `/graph` because an intro *is* graph-shaped — it is a request to add an
 * edge — and because there is no inbox screen to add it to.
 *
 * ⚠ **The `role` branch is structural here, not a conditional inside one component.** A
 * `via` row is an ask awaiting this viewer's decision, names both other parties, and owns
 * a draft note of its own; a `target` row is an introduction already made *to* them,
 * names the two people who made it, and answers a different procedure with a different
 * vocabulary (`intros.respond`, accept/decline — issue #166). Rendering Pass on on a
 * target row would offer an action the server refuses, so the two shapes do not share a
 * component that could grow a path between them.
 *
 * Renders nothing at all when there is nothing waiting — including while the read is in
 * flight. An empty state here would put "no intros" on a screen whose subject is the
 * network, every time anybody opened it.
 */
export function IntroInbox(): JSX.Element | null {
  const api = useApi();
  const queryClient = useQueryClient();

  const inbox = useQuery({
    queryKey: INTRO_INBOX_QUERY_KEY,
    queryFn: () => api.query('intros.listInbox', undefined),
  });

  /*
   * The last answer that *took* — a via's decision or a target's response, in the words of
   * whichever map owns it — because an answered row disappears on the re-read, and a card
   * vanishing under the finger with nothing said reads as a failure.
   *
   * One piece of state for both roles: only one row can be answered at a time (see `busy`
   * below), so there is only ever one thing to say.
   */
  const [confirmation, setConfirmation] = useState<string | null>(null);

  const decide = useMutation({
    mutationFn: (command: DecideIntroRequest) => api.mutate('intros.decide', command),
    onSuccess: (_result, command) => {
      setConfirmation(INTRO_DECISION_CONFIRMATION_LINE[command.decision]);
    },
    /*
     * `onSettled`, not `onSuccess`: a refusal here is usually the row having been decided
     * elsewhere, and the honest response to that is to re-read rather than to leave a
     * stale ask on screen with an error under it.
     */
    onSettled: () => queryClient.invalidateQueries({ queryKey: INTRO_INBOX_QUERY_KEY }),
  });

  /*
   * The target's answer (#166) — its own mutation rather than a branch inside `decide`,
   * because it calls a different procedure with a different vocabulary and the two rows
   * that submit them never appear in the same component.
   *
   * ⚠ The re-read this invalidates does **not** show the new connection: the server forms
   * the edge from the acceptance moments later (decision D12), so what re-reads here is
   * the inbox, which the answered row has now left. `INTRO_RESPONSE_CONFIRMATION_LINE`
   * carries that expectation instead of this component polling for a graph it does not own.
   */
  const respond = useMutation({
    mutationFn: (command: RespondToIntroRequest) => api.mutate('intros.respond', command),
    onSuccess: (_result, command) => {
      setConfirmation(INTRO_RESPONSE_CONFIRMATION_LINE[command.response]);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: INTRO_INBOX_QUERY_KEY }),
  });

  /*
   * One busy flag and one error line for both mutations. Every control on this list goes
   * down together while any answer is in flight, because two answers racing on one screen
   * is a way to answer the wrong row — the rule the `via` half already followed, extended
   * across the two roles rather than duplicated per role.
   */
  const busy = decide.isPending || respond.isPending;
  const refusal = decide.error ?? respond.error;

  const rows = inbox.data ?? [];

  /*
   * The confirmation holds the section open after the last row is decided: collapsing
   * to nothing in the same frame the decision lands would drop the announcement with it.
   */
  if (rows.length === 0 && confirmation === null) {
    return null;
  }

  return (
    <section className="intro-inbox" data-testid="intro-inbox" aria-label="Intros">
      <h2 className="intro-inbox__title">Intros</h2>

      {refusal === null ? null : (
        <p className="form__error" data-testid="intro-inbox-error" role="alert">
          {introRefusalMessage(applicationErrorCode(refusal))}
        </p>
      )}

      {confirmation === null ? null : (
        <p className="intro-inbox__confirmation" role="status" data-testid="intro-inbox-confirmation">
          {confirmation}
        </p>
      )}

      <ul className="intro-inbox__list">
        {rows.map((row) =>
          row.role === INTRO_INBOX_ROLE.target ? (
            <IntroductionMade
              key={row.id}
              row={row}
              answering={busy}
              onRespond={(command) => {
                respond.mutate(command);
              }}
            />
          ) : (
            <IntroAsk
              key={row.id}
              row={row}
              deciding={busy}
              onDecide={(command) => {
                decide.mutate(command);
              }}
            />
          ),
        )}
      </ul>
    </section>
  );
}

/**
 * An introduction that has already been made to this viewer, and the two answers to it.
 *
 * ⚠ **Two notes by two people, each under its own author's card** (#175). The requester
 * asked; the via agreed and said why. Running them together — or letting the via's words
 * sit under the requester's name — would attribute a vouch to the person being vouched
 * for, which is the one misreading this screen must not permit.
 *
 * The via's half is absent on an introduction passed on before #175 required a note, and
 * the requester's half then stands alone. There is no placeholder for the missing one: an
 * empty quote attributed to somebody is worse than a note they never wrote.
 *
 * ⚠ **Accepting is what makes the connection** (#166). Both controls submit in one press
 * and neither opens a field: an acceptance says nothing beyond itself, and a decline is
 * never shown to anybody, so a note here would be text written for a reader who does not
 * exist — the wire refuses one either way.
 *
 * ⚠ **{@link INTRO_ANSWER_LINE} sits above both controls and is not decoration.** An
 * introduction arrives from somebody the reader knows, about somebody they do not, and a
 * reader who does not know that refusing reaches nobody is a reader under obligation. It
 * is this screen's counterpart to the sheet's consent line, from the other end.
 *
 * @param answering - true while any answer on this list is in flight; every control goes
 *   down together, because two answers racing on one screen is a way to answer the wrong
 *   introduction.
 */
function IntroductionMade({
  row,
  answering,
  onRespond,
}: {
  readonly row: IntroInboxRow;
  readonly answering: boolean;
  readonly onRespond: (command: RespondToIntroRequest) => void;
}): JSX.Element {
  return (
    <li className="intro-inbox__item" data-testid="intro-inbox-target-row">
      <p className="intro-inbox__lede">
        <PersonIdentity identity={row.requester ?? WITHHELD} /> asked to be introduced to you.
      </p>

      <p className="intro-inbox__note" data-testid="intro-inbox-requester-note">
        {row.note}
      </p>

      {row.viaNote === undefined ? null : (
        <>
          <p className="intro-inbox__lede">
            <PersonIdentity identity={row.via ?? WITHHELD} /> {INTRO_VOUCHED_LINE}
          </p>

          <p className="intro-inbox__note" data-testid="intro-inbox-via-note">
            {row.viaNote}
          </p>
        </>
      )}

      <p className="intro-inbox__standing">{INTRO_ANSWER_LINE}</p>

      <div className="intro-inbox__actions">
        {/* A real `disabled` on both: the only reason either is off is an answer already
            in flight, which is a moment to wait out rather than something to fix. */}
        <button
          className="button button--primary"
          data-testid="intro-accept-button"
          type="button"
          disabled={answering}
          onClick={() => {
            onRespond({ introRequestId: row.id, response: INTRO_RESPONSE.accept });
          }}
        >
          {INTRO_ACCEPT_LABEL}
        </button>

        {/*
         * ⚠ Its own test id rather than the via row's `intro-decline-button`, because the
         * two press different procedures with different consequences — this one connects
         * nobody and tells nobody, that one answers somebody else's ask. One id for both
         * would let a walk that meant to decline an introduction silently decline an ask.
         */}
        <button
          className="button"
          data-testid="intro-target-decline-button"
          type="button"
          disabled={answering}
          onClick={() => {
            onRespond({ introRequestId: row.id, response: INTRO_RESPONSE.decline });
          }}
        >
          {INTRO_TARGET_DECLINE_LABEL}
        </button>
      </div>
    </li>
  );
}

/**
 * An ask waiting on this viewer's decision.
 *
 * The requester's note is rendered whole. It is the whole of what the via is being asked
 * to judge, and a truncated one would ask somebody to decide on half a sentence.
 *
 * ⚠ **Pass on opens a required note field; it does not decide anything** (#175). The
 * decision and the note are one submission, because they are one fact — the server writes
 * them in a single statement — and a control that passed an intro on and *then* asked for
 * words would leave a vouch that could fail after the introduction was already made.
 *
 * Decline stays exactly where it was, with no field beside it and none possible: the wire
 * carries no reason for a decline, because the via's rationale is theirs.
 *
 * @param deciding - true while any decision on this list is in flight; every control goes
 *   down together, because two decisions racing on one screen is a way to decide the
 *   wrong request.
 */
function IntroAsk({
  row,
  deciding,
  onDecide,
}: {
  readonly row: IntroInboxRow;
  readonly deciding: boolean;
  readonly onDecide: (command: DecideIntroRequest) => void;
}): JSX.Element {
  const lineId = useId();
  const lengthId = useId();
  const noteRef = useRef<HTMLTextAreaElement>(null);

  const [passingOn, setPassingOn] = useState(false);
  const [note, setNote] = useState('');

  /*
   * Focus follows the field into existence. Without this, pressing Pass on leaves a
   * keyboard or screen-reader user on a button whose label just changed, with a required
   * field they were never told about somewhere above it.
   */
  useEffect(() => {
    if (passingOn) {
      noteRef.current?.focus();
    }
  }, [passingOn]);

  const issues = inspectIntroNote(note);
  const over = issues.note === 'too-long';
  const sendable = issues.sendable && !deciding;
  const describedBy = over ? `${lineId} ${lengthId}` : lineId;

  function passOn(): void {
    if (!sendable) {
      return;
    }

    // Trimmed here as well as on the server, so what the via sees in the field and what
    // the target reads are the same words — the server's trim is the rule, not this one.
    onDecide({
      introRequestId: row.id,
      decision: INTRO_DECISION.passOn,
      note: note.trim(),
    });
  }

  return (
    <li className="intro-inbox__item" data-testid="intro-inbox-via-row">
      <p className="intro-inbox__lede">
        <PersonIdentity identity={row.requester ?? WITHHELD} /> asks you for an intro to{' '}
        <PersonIdentity identity={row.target ?? WITHHELD} />.
      </p>

      <p className="intro-inbox__note">{row.note}</p>

      {passingOn ? (
        <div className="intro-inbox__compose">
          <p className="intro-inbox__standing" id={lineId}>
            {INTRO_VIA_NOTE_LINE}
          </p>

          <label className="intro-inbox__field">
            <span className="intro-inbox__label">
              {viaNoteLabel(introPersonName(row.target))}
            </span>

            <textarea
              className="form__input form__input--prose intro-inbox__note-input"
              data-testid="intro-via-note-input"
              ref={noteRef}
              rows={3}
              /* No hard `maxLength`: truncating mid-sentence loses what somebody wrote.
                 The line below says it instead, and the server refuses it. */
              value={note}
              placeholder="Why should they meet? They’ll read this."
              aria-describedby={describedBy}
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
        </div>
      ) : null}

      <div className="intro-inbox__actions">
        {passingOn ? (
          /*
           * ⚠ `aria-disabled`, unlike the two controls beside it, and the difference is
           * `report-abuse-sheet.tsx`'s rule rather than a style choice: this one is off
           * because a field on screen needs filling in, so it stays focusable and
           * announced with the reason attached. A real `disabled` would drop it out of
           * the tab order and a screen-reader user would pass the thing they came to
           * press without ever hearing why it did nothing.
           */
          <button
            className="button button--primary"
            data-testid="intro-pass-on-submit-button"
            type="button"
            aria-disabled={!sendable}
            aria-describedby={describedBy}
            onClick={passOn}
          >
            {PASS_ON_WITH_NOTE_LABEL}
          </button>
        ) : (
          <button
            className="button button--primary"
            data-testid="intro-pass-on-button"
            type="button"
            /* A real `disabled`: the only reason this is off is a decision already in
               flight, which is a moment to wait out rather than something to fix. */
            disabled={deciding}
            onClick={() => {
              setPassingOn(true);
            }}
          >
            Pass on
          </button>
        )}

        {/*
         * ⚠ Declining sends no reason, and there is no field here to write one in. The
         * wire carries none because the via's rationale is theirs, and the requester is
         * told only that it was not passed on — which is what makes declining safe to do.
         * `DecideIntroRequest`'s decline branch has no `note`, so this is a rule the
         * compiler holds rather than one this file remembers.
         */}
        <button
          className="button"
          data-testid="intro-decline-button"
          type="button"
          disabled={deciding}
          onClick={() => {
            onDecide({ introRequestId: row.id, decision: INTRO_DECISION.decline });
          }}
        >
          Decline
        </button>
      </div>
    </li>
  );
}

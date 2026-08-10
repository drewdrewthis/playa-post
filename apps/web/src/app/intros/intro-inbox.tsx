import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type JSX } from 'react';

import {
  INTRO_DECISION,
  INTRO_INBOX_ROLE,
  type DecideIntroRequest,
  type IntroDecision,
  type IntroInboxRow,
} from '@playa-post/contracts';

import { useApi } from '../api/api-provider';
import { applicationErrorCode } from '../api/client';
import { PersonIdentity, type DisclosableIdentity } from '../people/person-identity';

import { INTRO_DECISION_CONFIRMATION_LINE, introRefusalMessage } from './intro-copy';
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
 * contract is deliberately untouched** (#89, §4): `GroupedNotification` has no `kind`
 * discriminator and groups into windows, which is the wrong shape for an individual
 * request that one person has to decide. The bell may one day count these; it will do it
 * by reading `intros.listInbox` alongside its own query, additively.
 *
 * It lives on `/graph` because an intro *is* graph-shaped — it is a request to add an
 * edge — and because there is no inbox screen to add it to.
 *
 * ⚠ **Branch on `role`.** A `via` row is an ask awaiting this viewer's decision and names
 * both other parties; a `target` row is an introduction already made *to* them and names
 * the requester only. Rendering Pass on / Decline on a target row would offer an action
 * the server refuses.
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
   * The last decision that *took*, in the words of `INTRO_DECISION_CONFIRMATION_LINE` —
   * because a decided row disappears on the re-read, and a card vanishing under the
   * finger with nothing said reads as a failure.
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

      {decide.error === null ? null : (
        <p className="form__error" data-testid="intro-inbox-error" role="alert">
          {introRefusalMessage(applicationErrorCode(decide.error))}
        </p>
      )}

      {confirmation === null ? null : (
        <p className="intro-inbox__confirmation" role="status" data-testid="intro-inbox-confirmation">
          {confirmation}
        </p>
      )}

      <ul className="intro-inbox__list">
        {rows.map((row) => (
          <IntroInboxItem
            key={row.id}
            row={row}
            deciding={decide.isPending}
            onDecide={(decision) => {
              decide.mutate({ introRequestId: row.id, decision });
            }}
          />
        ))}
      </ul>
    </section>
  );
}

/**
 * One row, in whichever of its two shapes the `role` names.
 *
 * The note is rendered whole in both. It is the whole of what the via is being asked to
 * judge and the whole of what the target is eventually shown — a truncated one would ask
 * somebody to decide on half a sentence.
 *
 * @param deciding - true while any decision on this list is in flight; both controls go
 *   down together, because two decisions racing on one screen is a way to decide the
 *   wrong request.
 */
function IntroInboxItem({
  row,
  deciding,
  onDecide,
}: {
  readonly row: IntroInboxRow;
  readonly deciding: boolean;
  readonly onDecide: (decision: IntroDecision) => void;
}): JSX.Element {
  if (row.role === INTRO_INBOX_ROLE.target) {
    return (
      <li className="intro-inbox__item" data-testid="intro-inbox-target-row">
        <p className="intro-inbox__lede">
          <PersonIdentity identity={row.requester ?? WITHHELD} /> asked to be introduced to
          you.
        </p>

        <p className="intro-inbox__note">{row.note}</p>
      </li>
    );
  }

  return (
    <li className="intro-inbox__item" data-testid="intro-inbox-via-row">
      <p className="intro-inbox__lede">
        <PersonIdentity identity={row.requester ?? WITHHELD} /> asks you for an intro to{' '}
        <PersonIdentity identity={row.target ?? WITHHELD} />.
      </p>

      <p className="intro-inbox__note">{row.note}</p>

      <div className="intro-inbox__actions">
        <button
          className="button button--primary"
          data-testid="intro-pass-on-button"
          type="button"
          disabled={deciding}
          onClick={() => {
            onDecide(INTRO_DECISION.passOn);
          }}
        >
          Pass on
        </button>

        {/*
         * ⚠ Declining sends no reason, and there is no field here to write one in. The
         * wire carries none because the via's rationale is theirs, and the requester is
         * told only that it was not passed on — which is what makes declining safe to do.
         */}
        <button
          className="button"
          data-testid="intro-decline-button"
          type="button"
          disabled={deciding}
          onClick={() => {
            onDecide(INTRO_DECISION.decline);
          }}
        >
          Decline
        </button>
      </div>
    </li>
  );
}

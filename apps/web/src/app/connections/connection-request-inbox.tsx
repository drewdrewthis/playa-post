import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type JSX } from 'react';

import {
  CONNECTION_REQUEST_DECISION,
  type ConnectionRequestDecision,
  type IncomingConnectionRequest,
} from '@playa-post/contracts';

import { useApi } from '../api/api-provider';
import { applicationErrorCode } from '../api/client';
import { GRAPH_LIST_QUERY_KEY } from '../graph/graph-query-keys';
import { PersonIdentity } from '../people/person-identity';

import { CONNECTION_REQUEST_INBOX_QUERY_KEY } from './connection-query-keys';
import {
  CONNECTION_REQUEST_ACCEPT_LABEL,
  CONNECTION_REQUEST_ANSWER_LINE,
  CONNECTION_REQUEST_CONFIRMATION_LINE,
  CONNECTION_REQUEST_DECLINE_LABEL,
  CONNECTION_REQUEST_INBOX_LOAD_ERROR_LINE,
  CONNECTION_REQUEST_INBOX_RETRY_LABEL,
  CONNECTION_REQUEST_INBOX_TITLE,
  CONNECTION_REQUEST_LEDE,
  connectionRefusalMessage,
} from './connection-request-copy';

import './connection-request-inbox.css';

/**
 * Connection requests waiting on this viewer, at the top of their graph (issue #206).
 *
 * ⚠ **This is the authoritative surface for a connection request**, and the notifications
 * contract is deliberately untouched — the same call `intros/intro-inbox.tsx` makes: a
 * notification is a thing you read and dismiss, which is the wrong shape for a request one
 * person has to *decide*.
 *
 * It lives on `/graph` beside the intro inbox because both are requests to add an edge to
 * the thing drawn below them, and because there is no inbox screen to add either to.
 *
 * ⚠ **There is no requester-side counterpart and there must not be one.** A requester never
 * reads their own request back, which is what keeps a decline indistinguishable from a
 * request nobody has answered — ADR-0017's founding invariant, one relationship along. An
 * acceptance still reaches them: the edge appears on their graph.
 *
 * Renders nothing at all when there is nothing waiting — including while the read is in
 * flight. An empty state here would put "no requests" on a screen whose subject is the
 * network, every time anybody opened it.
 */
export function ConnectionRequestInbox(): JSX.Element | null {
  const api = useApi();
  const queryClient = useQueryClient();

  const inbox = useQuery({
    queryKey: CONNECTION_REQUEST_INBOX_QUERY_KEY,
    queryFn: () => api.query('connections.requests.listInbox', undefined),
  });

  /*
   * The last answer that took, because an answered row disappears on the re-read and a card
   * vanishing under the finger with nothing said reads as a failure. One piece of state:
   * only one row can be answered at a time (see `busy`), so there is only ever one thing to
   * say.
   */
  const [confirmation, setConfirmation] = useState<string | null>(null);

  const decide = useMutation({
    mutationFn: (command: {
      readonly connectionRequestId: string;
      readonly decision: ConnectionRequestDecision;
    }) => api.mutate('connections.requests.decide', command),
    onSuccess: (_result, command) => {
      setConfirmation(CONNECTION_REQUEST_CONFIRMATION_LINE[command.decision]);
    },
    /*
     * `onSettled`, not `onSuccess`: a refusal here is usually the row having been decided on
     * another device or having lapsed, and the honest response to that is to re-read rather
     * than leave a stale request on screen with an error under it.
     *
     * ⚠ **The graph is invalidated too, and unlike the intro inbox that is not optimistic.**
     * An accepted request writes the edge in the same transaction as the answer (ADR-0018
     * D7), so by the time this resolves the connection exists and a re-read shows it. An
     * accepted *introduction* forms its edge from an event moments later, which is why
     * `intro-inbox.tsx` re-reads only itself and says "you are being connected".
     */
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: CONNECTION_REQUEST_INBOX_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: GRAPH_LIST_QUERY_KEY }),
      ]);
    },
  });

  const rows = inbox.data ?? [];

  /*
   * The confirmation holds the section open after the last row is answered: collapsing to
   * nothing in the same frame the decision lands would drop the announcement with it. A
   * failed read holds it open too — "renders nothing" is a claim about a *known-empty*
   * inbox, and an owner whose read failed may have requests they cannot see.
   */
  if (rows.length === 0 && confirmation === null && !inbox.isError) {
    return null;
  }

  return (
    <section
      className="request-inbox"
      data-testid="connection-request-inbox"
      aria-label={CONNECTION_REQUEST_INBOX_TITLE}
    >
      <h2 className="request-inbox__title">{CONNECTION_REQUEST_INBOX_TITLE}</h2>

      {!inbox.isError ? null : (
        <>
          <p
            className="form__error"
            data-testid="connection-request-inbox-load-error"
            role="alert"
          >
            {CONNECTION_REQUEST_INBOX_LOAD_ERROR_LINE}
          </p>
          <button
            className="button"
            data-testid="connection-request-inbox-retry-button"
            type="button"
            onClick={() => {
              void inbox.refetch();
            }}
          >
            {CONNECTION_REQUEST_INBOX_RETRY_LABEL}
          </button>
        </>
      )}

      {decide.error === null ? null : (
        <p className="form__error" data-testid="connection-request-inbox-error" role="alert">
          {connectionRefusalMessage(applicationErrorCode(decide.error))}
        </p>
      )}

      {confirmation === null ? null : (
        <p
          className="request-inbox__confirmation"
          role="status"
          data-testid="connection-request-inbox-confirmation"
        >
          {confirmation}
        </p>
      )}

      <ul className="request-inbox__list">
        {rows.map((row) => (
          <IncomingRequest
            key={row.id}
            row={row}
            answering={decide.isPending}
            onDecide={(decision) => {
              decide.mutate({ connectionRequestId: row.id, decision });
            }}
          />
        ))}
      </ul>
    </section>
  );
}

/**
 * One request waiting on the owner, and the two answers to it.
 *
 * ⚠ **{@link CONNECTION_REQUEST_ANSWER_LINE} sits above both controls and is not
 * decoration.** A request arrives from somebody who has your link — which frequently means
 * somebody you just met, or somebody a friend forwarded it to — and a reader who does not
 * know that refusing reaches nobody is a reader under obligation. The whole product argument
 * for making the owner the gate collapses if saying no feels visible.
 *
 * ⚠ **Neither control opens a field.** An acceptance says nothing beyond itself and a
 * decline is never shown to anybody, so a note here would be text written for a reader who
 * does not exist — the wire refuses one either way.
 *
 * @param answering - true while any answer on this list is in flight; every control goes
 *   down together, because two answers racing on one screen is a way to answer the wrong
 *   request.
 */
function IncomingRequest({
  row,
  answering,
  onDecide,
}: {
  readonly row: IncomingConnectionRequest;
  readonly answering: boolean;
  readonly onDecide: (decision: ConnectionRequestDecision) => void;
}): JSX.Element {
  return (
    <li className="request-inbox__item" data-testid="connection-request-row">
      <p className="request-inbox__lede">
        <PersonIdentity identity={row.requester} /> {CONNECTION_REQUEST_LEDE}
      </p>

      <p className="request-inbox__standing">{CONNECTION_REQUEST_ANSWER_LINE}</p>

      <div className="request-inbox__actions">
        {/* A real `disabled` on both: the only reason either is off is an answer already in
            flight, which is a moment to wait out rather than something to fix. */}
        <button
          className="button button--primary"
          data-testid="connection-request-accept-button"
          type="button"
          disabled={answering}
          onClick={() => {
            onDecide(CONNECTION_REQUEST_DECISION.accept);
          }}
        >
          {CONNECTION_REQUEST_ACCEPT_LABEL}
        </button>

        {/*
         * ⚠ Its own test id rather than the intro inbox's `intro-target-decline-button`. The
         * two press different procedures with different consequences, and one id shared
         * across them would let a walk that meant to decline a connection request silently
         * decline an introduction.
         */}
        <button
          className="button"
          data-testid="connection-request-decline-button"
          type="button"
          disabled={answering}
          onClick={() => {
            onDecide(CONNECTION_REQUEST_DECISION.decline);
          }}
        >
          {CONNECTION_REQUEST_DECLINE_LABEL}
        </button>
      </div>
    </li>
  );
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { JSX } from 'react';
import { useParams } from 'react-router';

import { PERSONAL_LINK_VIEWER_STATE } from '@playa-post/contracts';

import { useApi } from '../api/api-provider';
import { applicationErrorCode } from '../api/client';
import { personalLinkQueryKey } from '../connections/connection-query-keys';
import {
  ALREADY_CONNECTED_LINE,
  CONNECTION_REQUEST_SENT_LINE,
  connectionPersonName,
  connectionRefusalMessage,
  OWN_LINK_LINE,
  PERSONAL_LINK_ASK_LINE,
  PERSONAL_LINK_OPENING_LINE,
  PERSONAL_LINK_UNAVAILABLE_LINE,
  personalLinkTitle,
  SEND_CONNECTION_REQUEST_LABEL,
} from '../connections/connection-request-copy';
import { PersonIdentity } from '../people/person-identity';

/**
 * `/c/:slug` — somebody's personal link, opened (issue #206).
 *
 * ⚠ **Two steps, and the first one connects nobody.** The query says who this address
 * belongs to; the mutation asks them. That separation is the whole feature: the screen this
 * replaces (`/invite/:token`) connected the opener to a stranger on one tap, and the first
 * person to open a re-shared link spent it for everybody else — the prod failure #206 was
 * filed for.
 *
 * ⚠ **Every failed resolution renders the identical neutral line.** Unknown slug, malformed
 * slug, deactivated owner, and a slug the owner has *rotated away from* are one screen with
 * one sentence. The rotated case is the one that must never be distinguished: whoever kept
 * the old URL is frequently the reason it was rotated, and "that link was retired" tells them
 * it was real and deliberately replaced.
 *
 * It lives inside `ProtectedLayout`, beside `/invite/:token`, so an arrival with no session
 * is bounced through sign-in and returned here (#205) rather than shown a name to a signed-out
 * stranger.
 */
export function PersonalLinkOpenRoute(): JSX.Element {
  const api = useApi();
  const queryClient = useQueryClient();
  const { slug } = useParams<{ slug: string }>();

  const link = useQuery({
    queryKey: personalLinkQueryKey(slug ?? ''),
    queryFn: () => api.query('connections.personalLink.open', { slug: slug ?? '' }),
    enabled: slug !== undefined && slug !== '',
  });

  const send = useMutation({
    mutationFn: () => api.mutate('connections.requests.send', { slug: slug ?? '' }),
    /*
     * `onSettled`, not `onSuccess`: a refusal here is most often the request having already
     * been sent from another device, or the pair having connected meanwhile, and the honest
     * response to either is to re-read this screen rather than leave a stale button with an
     * error under it. The re-read is what produces the "request sent" state — it is the
     * server's `viewerState`, not a local flag a reload would lose.
     *
     * ⚠ The graph is deliberately **not** invalidated. Sending adds no edge, so re-reading
     * it would be a request for nothing; the graph invalidation belongs on the owner's
     * decide (`connections/connection-request-inbox.tsx`), which is where one appears.
     */
    onSettled: () => queryClient.invalidateQueries({ queryKey: personalLinkQueryKey(slug ?? '') }),
  });

  if (link.data === undefined) {
    return (
      <section className="screen">
        <h1 className="screen__title">Connect</h1>
        <p className="screen__notice" data-testid="personal-link-notice">
          {/*
            An absent or empty slug disables the query, which then never errors — without
            the second condition this screen would show the opening line forever.
          */}
          {link.error === null && slug !== undefined && slug !== ''
            ? PERSONAL_LINK_OPENING_LINE
            : PERSONAL_LINK_UNAVAILABLE_LINE}
        </p>
      </section>
    );
  }

  const { owner, viewerState } = link.data;
  const name = connectionPersonName(owner);

  return (
    <section className="screen" data-testid="personal-link-view">
      <h1 className="screen__title">{personalLinkTitle(name)}</h1>

      {/*
        The owner's card, rendered by the one component that knows what "no name" means.
        The server projects an owner from their own self-projection, so a name is normally
        there — but the withheld treatment is what must appear if it ever is not, rather
        than a placeholder assembled here.
      */}
      <p className="screen__lede">
        <PersonIdentity identity={owner} />
      </p>

      {viewerState === PERSONAL_LINK_VIEWER_STATE.own ? (
        <p className="screen__notice" data-testid="personal-link-own">
          {OWN_LINK_LINE}
        </p>
      ) : viewerState === PERSONAL_LINK_VIEWER_STATE.connected ? (
        <p className="banner banner--good" role="status" data-testid="personal-link-connected">
          {ALREADY_CONNECTED_LINE}
        </p>
      ) : viewerState === PERSONAL_LINK_VIEWER_STATE.requested ? (
        <p className="banner banner--good" role="status" data-testid="connection-request-sent">
          {CONNECTION_REQUEST_SENT_LINE}
        </p>
      ) : (
        <>
          {/*
            ⚠ Above the button, never under it. Somebody arriving from a QR expects a tap
            to connect them — that is what the link this replaces did — so the sentence
            that corrects the expectation has to be read before the press, not after it.
          */}
          <p className="screen__aside">{PERSONAL_LINK_ASK_LINE}</p>

          {send.error === null ? null : (
            <p className="form__error" role="alert" data-testid="connection-request-error">
              {connectionRefusalMessage(applicationErrorCode(send.error))}
            </p>
          )}

          <button
            className="button button--primary"
            data-testid="send-connection-request-button"
            type="button"
            disabled={send.isPending}
            onClick={() => {
              send.mutate();
            }}
          >
            {SEND_CONNECTION_REQUEST_LABEL}
          </button>
        </>
      )}
    </section>
  );
}

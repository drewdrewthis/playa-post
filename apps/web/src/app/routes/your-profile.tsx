import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLiveQuery } from 'dexie-react-hooks';
import type { JSX } from 'react';
import { Link } from 'react-router';

import type { VisibleToDistance } from '@playa-post/contracts';

import { useApi } from '../api/api-provider';
import { useSession } from '../auth/session-provider';
import { summariseGraph, VIEWER_DEGREE } from '../graph/graph-counts';
import { GRAPH_LIST_QUERY_KEY } from '../graph/graph-query-keys';
import { useOffline } from '../offline/offline-provider';
import { describeQueuedMutation, sortedQueue } from '../offline/sync-queue-view';
import { ConnectCard } from '../profile/connect-card';
import { DisplayNameEditor } from '../profile/display-name-editor';
import { RetryRow } from '../profile/retry-row';
import {
  describeVisibility,
  nextVisibility,
  VISIBILITY_DIAL_LABELS,
} from '../profile/visibility-dial';

import '../profile/your-profile.css';

/**
 * `/you` — the You screen (issue #49, `design/Playa Post.dc.html`'s `data-screen-label="You"`).
 *
 * Three things, in the comp's order: who you are, how somebody connects to you, and what
 * has not synced yet. Every one of them is backed by a procedure this server already
 * serves — `graph.list`, `connections.invitations.create`, and the Dexie queue the sync
 * runner drains.
 *
 * The **CONNECT card stands ready**, exactly as the comp draws it: QR, link, consent line
 * and share button are on screen the moment the card is, with nothing to press first. It
 * is also the *only* place an invite is minted — the graph screen's "Create an invite"
 * button was a remnant the comp never had
 * ([#142](https://github.com/drewdrewthis/playa-post/issues/142)).
 *
 * The **Who can see you** dial is the comp's privacy block, corrected: the comp labels it
 * "who sees your name", the product owner renamed it to what it actually does — beyond
 * your limit you are absent from the other person's graph entirely, not unnamed on it.
 * Its trust half ("visible to trust 50+") is a later version; the "who can pin to your
 * board" limit stays deferred with it.
 *
 * ⚠ **The comp's Blocked-people block is deliberately absent rather than mocked**, because
 * a control that renders and does nothing is a lie told in the user's own settings screen:
 * `moderation` reports and dismisses *bulletins*; blocking a *person* has no table, no
 * procedure and no contract, so there is nothing for a list to read.
 *
 * The comp's **QR** stood on that list until now. Encoding one needs a Reed-Solomon
 * implementation and this repo forbids hand-rolling infrastructure (addendum §18), so it
 * was a dependency decision to take deliberately rather than in passing — and the product
 * owner has now taken it in
 * [#90](https://github.com/drewdrewthis/playa-post/issues/90): `react-qr-code`.
 */
export function YourProfileRoute(): JSX.Element {
  const api = useApi();
  const { signOut } = useSession();
  const { database } = useOffline();

  // The viewer is on their own graph at degree 0 with `full` disclosure, so their name and
  // both counts come from a query this app already makes and caches. A second procedure
  // for "who am I" would be a second answer to a question `graph.list` has answered since
  // M2.7 — and two answers eventually disagree.
  const graph = useQuery({
    queryKey: GRAPH_LIST_QUERY_KEY,
    queryFn: () => api.query('graph.list', undefined),
  });

  const queryClient = useQueryClient();
  const visibility = useQuery({
    queryKey: ['identity', 'visibility'],
    queryFn: () => api.query('identity.visibility.get', undefined),
  });
  const setVisibility = useMutation({
    mutationFn: (visibleToDistance: VisibleToDistance) =>
      api.mutate('identity.visibility.set', { visibleToDistance }),
    // The server's echo is the truth the cache keeps — not the value we asked for, so a
    // race between two taps settles on what was actually stored.
    onSuccess: (stored) => queryClient.setQueryData(['identity', 'visibility'], stored),
  });
  const visibilityValue = visibility.data?.visibleToDistance;

  // `useLiveQuery` rather than a copy of the queue in React state: Dexie is already the
  // source of truth, and a mirrored copy is a mirror that can be wrong. `[]` is the
  // initial value, so the section renders its quiet line rather than flashing empty.
  const queued = useLiveQuery(() => database.pendingMutations.toArray(), [database], []);

  const me = graph.data?.people.find((person) => person.degree === VIEWER_DEGREE);
  const summary = summariseGraph(graph.data?.people ?? []);

  return (
    <section className="screen" data-testid="your-profile">
      <div className="profile__identity">
        {/*
          The initial, from the viewer's own disclosed name. Safe here and nowhere else:
          `PersonIdentity` refuses to derive a placeholder because doing so re-identifies
          somebody the projection hid — this is the one person on the graph whose identity
          is never withheld from this reader.
        */}
        <span className="profile__avatar" aria-hidden="true">
          {me?.displayName?.slice(0, 1).toUpperCase() ?? ''}
        </span>
        <div className="profile__identity-text">
          {/*
            The heading and the way to change it are one component, so the edit happens
            where the name is rather than on a screen of its own (#177). The handle is
            deliberately not editable beside it — ADR-0008 rule 4, decision D15.
          */}
          <DisplayNameEditor displayName={me?.displayName} />
          <p className="profile__counts" data-testid="profile-counts">
            {summary.people} connections · {summary.trusted} trusted
          </p>
        </div>
      </div>

      <div className="profile__section">
        <h2 className="profile__section-label">Connect</h2>
        <ConnectCard />
      </div>

      <div className="profile__section">
        <h2 className="profile__section-label">Who can see you</h2>

        {visibility.isError ? (
          <RetryRow
            message="Your visibility setting did not load."
            onRetry={() => void visibility.refetch()}
          />
        ) : visibilityValue === undefined ? (
          <p className="profile__quiet">Loading your visibility…</p>
        ) : (
          <>
            <div className="profile__row">
              <span className="profile__queue-text">Visible up to</span>
              <button
                className="profile__pill profile__pill--good profile__dial"
                data-testid="visibility-dial"
                type="button"
                disabled={setVisibility.isPending}
                onClick={() => setVisibility.mutate(nextVisibility(visibilityValue))}
              >
                {VISIBILITY_DIAL_LABELS[visibilityValue]}
              </button>
            </div>
            <p className="screen__aside">{describeVisibility(visibilityValue)}</p>
          </>
        )}

        {setVisibility.error === null ? null : (
          <p className="form__error" role="alert">
            That change did not save. Tap it again.
          </p>
        )}
      </div>

      <div className="profile__section">
        <h2 className="profile__section-label">Sync</h2>

        {queued.length === 0 ? (
          <p className="profile__quiet">Everything you have written is on the server.</p>
        ) : (
          <ul className="profile__queue" data-testid="sync-queue">
            {sortedQueue(queued).map((row) => {
              const view = describeQueuedMutation(row);

              return (
                <li className="profile__row" key={row.mutationId}>
                  <span className="profile__queue-text">{view.text}</span>
                  <span
                    className={`profile__pill profile__pill--${view.tone}`}
                    data-state={row.state}
                  >
                    {view.pill}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        <p className="screen__aside">
          Offline, you keep the last synced graph and board. Anything you post queues and
          syncs later.
        </p>
      </div>

      {/* The comp's "REPLAY WELCOME →" link. A route, not an overlay: the welcome
          screen exits to /signin, which bounces a signed-in replayer straight home. */}
      <Link className="profile__replay" data-testid="replay-welcome" to="/welcome">
        Replay welcome →
      </Link>

      <button
        className="button button--quiet profile__sign-out"
        data-testid="sign-out-button"
        type="button"
        onClick={() => {
          void signOut();
        }}
      >
        Sign out
      </button>
    </section>
  );
}

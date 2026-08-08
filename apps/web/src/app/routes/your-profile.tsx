import { useMutation, useQuery } from '@tanstack/react-query';
import { useLiveQuery } from 'dexie-react-hooks';
import type { JSX } from 'react';

import { useApi } from '../api/api-provider';
import { useSession } from '../auth/session-provider';
import { summariseGraph, VIEWER_DEGREE } from '../graph/graph-counts';
import { useOffline } from '../offline/offline-provider';
import { describeQueuedMutation, sortedQueue } from '../offline/sync-queue-view';
import { inviteShareText, inviteUrl } from '../profile/invite-share';

import '../profile/your-profile.css';

/**
 * `/you` — the You screen (issue #49, `design/Playa Post.dc.html`'s `data-screen-label="You"`).
 *
 * Three things, in the comp's order: who you are, how somebody connects to you, and what
 * has not synced yet. Every one of them is backed by a procedure this server already
 * serves — `graph.list`, `connections.invitations.create`, and the Dexie queue the sync
 * runner drains.
 *
 * ⚠ **Three of the comp's blocks are deliberately absent rather than mocked**, because a
 * control that renders and does nothing is a lie told in the user's own settings screen:
 *
 * - **The two standing privacy limits** ("who sees your name", "who can pin to your
 *   board"). Their *default* is an open product question, and a default that ships
 *   becomes a migration and a backfill to change. Deferred whole — server module,
 *   contract, and migration together — so nothing half-wired is left behind.
 * - **Blocked people.** `moderation` reports and dismisses *bulletins*; blocking a
 *   *person* has no table, no procedure, and no contract, so there is nothing for a list
 *   to read.
 * - **A scannable QR.** Encoding one needs a Reed-Solomon implementation, and this repo
 *   forbids hand-rolling infrastructure (addendum §18) — so it is a new dependency, which
 *   is a decision to take deliberately rather than in passing. The invite link and the
 *   share sheet below are the working half, and they are the half that actually connects
 *   two people.
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
    queryKey: ['graph', 'list'],
    queryFn: () => api.query('graph.list', undefined),
  });

  const invite = useMutation({
    mutationFn: () => api.mutate('connections.invitations.create', undefined),
  });

  // `useLiveQuery` rather than a copy of the queue in React state: Dexie is already the
  // source of truth, and a mirrored copy is a mirror that can be wrong. `[]` is the
  // initial value, so the section renders its quiet line rather than flashing empty.
  const queued = useLiveQuery(() => database.pendingMutations.toArray(), [database], []);

  const me = graph.data?.people.find((person) => person.degree === VIEWER_DEGREE);
  const summary = summariseGraph(graph.data?.people ?? []);

  const shareUrl =
    invite.data === undefined ? null : inviteUrl(window.location.origin, invite.data.token);

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
          <h1 className="profile__name">{me?.displayName ?? 'You'}</h1>
          <p className="profile__counts" data-testid="profile-counts">
            {summary.people} connections · {summary.trusted} trusted
          </p>
        </div>
      </div>

      <div className="profile__section">
        <h2 className="profile__section-label">Connect</h2>

        <div className="profile__connect">
          <div className="profile__connect-body">
            {shareUrl === null ? (
              <p className="screen__aside">
                Create an invite to get a link you can send. Nothing happens until you both
                consent.
              </p>
            ) : (
              <>
                <span className="profile__invite-link" data-testid="invite-link">
                  {shareUrl}
                </span>
                <p className="screen__aside">
                  Send this to one person. Nothing happens until you both consent.
                </p>
              </>
            )}

            <button
              className="profile__share"
              data-testid="invite-share-button"
              type="button"
              disabled={invite.isPending}
              onClick={() => {
                if (shareUrl === null) {
                  invite.mutate();
                  return;
                }

                void shareInvite(shareUrl);
              }}
            >
              {shareUrl === null ? 'Create invite' : 'Share invite'}
            </button>
          </div>
        </div>

        {invite.error === null ? null : (
          <p className="form__error" role="alert">
            That invite did not get created. Try again.
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

/**
 * Hand the invite to the platform's share sheet, or to the clipboard.
 *
 * ⚠ Both branches can reject — `navigator.share` throws `AbortError` when the user
 * dismisses the sheet, and the clipboard throws when the document is not focused. Neither
 * is a failure worth interrupting anybody over, and neither leaves the app in a bad state,
 * so both are swallowed. The link is on screen either way, which is the fallback that
 * always works.
 */
async function shareInvite(url: string): Promise<void> {
  try {
    if (typeof navigator.share === 'function') {
      await navigator.share({ text: inviteShareText(url), url });
      return;
    }

    await navigator.clipboard.writeText(url);
  } catch {
    // Deliberately silent; see above.
  }
}

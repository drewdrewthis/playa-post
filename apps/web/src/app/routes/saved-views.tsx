import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type JSX } from 'react';
import { useNavigate } from 'react-router';

import { useApi } from '../api/api-provider';
import {
  bellActionLabel,
  bellLabel,
  deleteActionLabel,
  matchNowLabel,
  MATCH_COUNT_UNAVAILABLE_LABEL,
  notifyToast,
} from '../views/saved-view-list';

import '../views/saved-views.css';

/**
 * `/saved` — the named board queries this person has kept (issue #45).
 *
 * ⚠ **The "N match now" line is `bulletins.board` run per view, not a number this screen
 * computed.** Saved views run over what the viewer can already see and never more
 * (ADR-0002 §6, and the lede says so out loud), so the count has to come from the one
 * read that decides that — which also makes it provably the number the board shows when
 * "OPEN ON BOARD" is tapped, page-size ceiling included. The cache key is deliberately
 * the same one `board.tsx` uses, so opening a view lands on an answer already in hand.
 *
 * Those reads go out together and `httpBatchLink` folds them into one HTTP request, so a
 * list of views costs one round trip rather than one each.
 *
 * ⚠ **The bell is one designation, not a flag per card.** Product decision D1: there is
 * exactly one Notify Me query per user, and lighting the bell on view B moves it off view
 * A. `notifyingViewId` is therefore server state this screen renders rather than a local
 * toggle it tracks — the server's answer to `setNotify` names where the bell ended up, so
 * a race cannot leave two cards looking lit.
 *
 * There is deliberately **no rename control**: the comp draws none, and tapping a card's
 * name opens it on the board. `views.saved.rename` exists behind the API for the client
 * that grows one.
 */
export function SavedViewsRoute(): JSX.Element {
  const api = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  /**
   * The one line of prose under the header, and whether it is reporting a failure.
   *
   * ⚠ **`failed` is not decoration.** Both mutations here can be refused or dropped, and
   * a failure rendered in the same voice as "View deleted" is worse than silence — it
   * tells someone the thing happened.
   */
  const [status, setStatus] = useState<{ message: string; failed: boolean } | null>(null);

  const saved = useQuery({
    queryKey: ['views', 'saved', 'list'],
    queryFn: () => api.query('views.saved.list', undefined),
  });

  const views = saved.data?.views ?? [];
  const notifyingViewId = saved.data?.notifyingViewId ?? null;

  const counts = useQueries({
    queries: views.map((view) => ({
      // The same key shape `board.tsx` uses, on purpose — see this component's note.
      queryKey: ['bulletins', 'board', view.sourceText],
      queryFn: () => api.query('bulletins.board', { query: view.sourceText }),
      // `select` narrows what this screen observes without narrowing what the cache
      // holds, so the board still finds a whole page under the same key.
      select: (board: { items: readonly unknown[] }) => board.items.length,
    })),
  });

  async function refresh(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: ['views', 'saved', 'list'] });
  }

  const setNotify = useMutation({
    mutationFn: (input: { viewId: string; notify: boolean; name: string }) =>
      api.mutate('views.saved.setNotify', { viewId: input.viewId, notify: input.notify }),
    onSuccess: async (result, input) => {
      // Reported from the server's answer rather than from what was requested: the bell
      // may have ended up somewhere else entirely if another device moved it first.
      setStatus({
        message: notifyToast(result.notifyingViewId === input.viewId, input.name),
        failed: false,
      });
      await refresh();
    },
    // ⚠ `retry: false` is the app-wide default, so this is the only attempt. Without it
    // a failed tap re-renders as the state it was already in, which reads as "the tap
    // did not register" — and the next tap is the same request failing the same way.
    onError: (_error, input) => {
      setStatus({
        message: `Notifications for ${input.name} could not be changed. Check your connection and try again.`,
        failed: true,
      });
    },
  });

  const remove = useMutation({
    mutationFn: (input: { viewId: string; name: string }) =>
      api.mutate('views.saved.delete', { viewId: input.viewId }),
    onSuccess: async () => {
      setStatus({ message: 'View deleted', failed: false });
      await refresh();
    },
    // ⚠ The sharper of the two silences: on failure the card is still there, and a card
    // that is still there is exactly what a *successful* delete would not leave. Without
    // this, "it did not delete" and "the request never arrived" look identical.
    onError: (_error, input) => {
      setStatus({
        message: `${input.name} could not be deleted. Check your connection and try again.`,
        failed: true,
      });
    },
  });

  function openOnBoard(sourceText: string): void {
    // The comp's `onOpen`: the board's chip resets to All and the whole saved text goes
    // into the query, because a saved `type:` term already says what the chip would.
    void navigate(`/board?q=${encodeURIComponent(sourceText)}`);
  }

  return (
    <section className="screen" data-testid="saved-views">
      <h1 className="sr-only">Saved</h1>

      <p className="saved-views__lede">
        Saved views run over what you can already see — never more.
      </p>

      {status === null ? null : (
        <p
          className={
            status.failed ? 'saved-views__status saved-views__status--failed' : 'saved-views__status'
          }
          data-testid="saved-views-status"
          data-failed={status.failed ? 'true' : 'false'}
          // A refusal is announced as one: `alert` interrupts, `status` waits for a gap.
          // The person is mid-interaction and just did something that did not happen.
          role={status.failed ? 'alert' : 'status'}
        >
          {status.message}
        </p>
      )}

      {saved.isError ? (
        <p className="form__error" data-testid="saved-views-error">
          Your saved views could not be loaded. Check your connection and try again.
        </p>
      ) : views.length === 0 ? (
        <p className="screen__empty">
          {saved.isSuccess ? 'Nothing saved yet. Search the board and save what you find.' : ''}
        </p>
      ) : (
        <ul className="saved-view-list">
          {views.map((view, index) => {
            const notifying = view.id === notifyingViewId;
            const countQuery = counts[index];
            const count = countQuery?.data ?? null;
            const countLabel = matchNowLabel(typeof count === 'number' ? count : null);
            // ⚠ Told apart from "still loading", which also renders no number. `retry:
            // false` is deliberate and app-wide, so a dropped request is permanent — and
            // these go out batched, so one drop blanks every card at once. An empty span
            // where a count belongs, forever, with no way back short of remounting the
            // route, is the one failure an offline-first screen must not choose.
            const countFailed = countQuery?.isError ?? false;

            // ⚠ Scoped to this row. `setNotify` and `remove` are one mutation object each,
            // shared by every card, so an unscoped `isPending` gates all two dozen cards
            // on any one card's request.
            const bellPending = setNotify.isPending && setNotify.variables?.viewId === view.id;
            const deletePending = remove.isPending && remove.variables?.viewId === view.id;

            return (
              <li key={view.id}>
                <article className="saved-view" data-testid="saved-view">
                  <div className="saved-view__header">
                    <button
                      className="saved-view__name"
                      data-testid="saved-view-name"
                      type="button"
                      onClick={() => {
                        openOnBoard(view.sourceText);
                      }}
                    >
                      {view.name}
                    </button>

                    <button
                      className="saved-view__bell"
                      data-testid="saved-view-bell"
                      type="button"
                      // The state, not the action: the visible label already says which
                      // it is, and `aria-pressed` is what the CSS keys the lit style off
                      // so the two can never disagree. The *name* says which view, which
                      // is the thing 24 identical bells otherwise cannot tell anyone.
                      aria-label={bellActionLabel(view.name)}
                      aria-pressed={notifying}
                      // ⚠ `aria-disabled`, not `disabled`. A browser moves focus off a
                      // disabled element to `<body>`, so disabling the button someone
                      // just activated drops them at the top of the document mid-
                      // interaction, silently, and does not put them back. The handler
                      // guards instead.
                      aria-disabled={bellPending}
                      data-pending={bellPending ? 'true' : 'false'}
                      onClick={() => {
                        if (bellPending) {
                          return;
                        }
                        setNotify.mutate({
                          viewId: view.id,
                          notify: !notifying,
                          name: view.name,
                        });
                      }}
                    >
                      {bellLabel(notifying)}
                    </button>
                  </div>

                  <p className="saved-view__query">{view.sourceText}</p>

                  <div className="saved-view__meta">
                    {countFailed ? (
                      <span className="saved-view__count saved-view__count--failed">
                        <span data-testid="saved-view-count">{MATCH_COUNT_UNAVAILABLE_LABEL}</span>{' '}
                        <button
                          className="button button--quiet saved-view__count-retry"
                          data-testid="saved-view-count-retry"
                          type="button"
                          onClick={() => {
                            void countQuery?.refetch();
                          }}
                        >
                          Retry
                        </button>
                      </span>
                    ) : (
                      <span className="saved-view__count" data-testid="saved-view-count">
                        {countLabel}
                      </span>
                    )}

                    <button
                      className="saved-view__delete"
                      data-testid="saved-view-delete"
                      type="button"
                      // The comp's DELETE is a bare tap with no confirmation, which is
                      // right for a list somebody curates — but deleting the view the
                      // bell is on also ends those notifications, so the control's own
                      // name says so.
                      aria-label={deleteActionLabel(view.name, notifying)}
                      // Row-scoped, and `aria-disabled` rather than `disabled`, for the
                      // same two reasons the bell above states.
                      aria-disabled={deletePending}
                      data-pending={deletePending ? 'true' : 'false'}
                      onClick={() => {
                        if (deletePending) {
                          return;
                        }
                        remove.mutate({ viewId: view.id, name: view.name });
                      }}
                    >
                      DELETE
                    </button>
                  </div>

                  <button
                    className="saved-view__open"
                    data-testid="saved-view-open"
                    type="button"
                    onClick={() => {
                      openOnBoard(view.sourceText);
                    }}
                  >
                    OPEN ON BOARD →
                  </button>
                </article>
              </li>
            );
          })}
        </ul>
      )}

      <p className="screen__aside">
        Any board search can be saved. Notify Me pings you when a new bulletin matches the
        query.
      </p>
    </section>
  );
}

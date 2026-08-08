import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type JSX } from 'react';
import { useNavigate } from 'react-router';

import { useApi } from '../api/api-provider';
import {
  bellLabel,
  deleteActionLabel,
  matchNowLabel,
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
  const [status, setStatus] = useState<string | null>(null);

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
      setStatus(notifyToast(result.notifyingViewId === input.viewId, input.name));
      await refresh();
    },
  });

  const remove = useMutation({
    mutationFn: (input: { viewId: string; name: string }) =>
      api.mutate('views.saved.delete', { viewId: input.viewId }),
    onSuccess: async () => {
      setStatus('View deleted');
      await refresh();
    },
  });

  function openOnBoard(sourceText: string): void {
    // The comp's `onOpen`: the board's chip resets to All and the whole saved text goes
    // into the query, because a saved `type:` term already says what the chip would.
    void navigate(`/board?q=${encodeURIComponent(sourceText)}`);
  }

  return (
    <section className="screen" data-testid="saved-views">
      <header className="screen__header">
        <h1 className="screen__title">Saved</h1>
      </header>

      <p className="saved-views__lede">
        Saved views run over what you can already see — never more.
      </p>

      {status === null ? null : (
        <p className="saved-views__status" data-testid="saved-views-status" role="status">
          {status}
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
            const count = counts[index]?.data ?? null;
            const countLabel = matchNowLabel(typeof count === 'number' ? count : null);

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
                      // so the two can never disagree.
                      aria-pressed={notifying}
                      disabled={setNotify.isPending}
                      onClick={() => {
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
                    <span className="saved-view__count" data-testid="saved-view-count">
                      {countLabel}
                    </span>

                    <button
                      className="saved-view__delete"
                      data-testid="saved-view-delete"
                      type="button"
                      // The comp's DELETE is a bare tap with no confirmation, which is
                      // right for a list somebody curates — but deleting the view the
                      // bell is on also ends those notifications, so the control's own
                      // name says so.
                      aria-label={deleteActionLabel(view.name, notifying)}
                      disabled={remove.isPending}
                      onClick={() => {
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

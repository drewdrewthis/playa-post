import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useState, type JSX } from 'react';
import { useSearchParams } from 'react-router';

import type { ModerationTargetRequest, ReportBulletinRequest } from '@playa-post/contracts';

import { useApi } from '../api/api-provider';
import { applicationErrorCode } from '../api/client';
import type { BoardCardView } from '../bulletins/board-card-view';
import { buildBoardQuery, parseBoardQueryState, type BoardTypeFilter } from '../bulletins/board-query';
import { BoardSearch } from '../bulletins/board-search';
import { BulletinCard } from '../bulletins/bulletin-card';
import { BulletinDetailSheet } from '../bulletins/bulletin-detail-sheet';
import { describeHideFailure } from '../moderation/hide-failure';
import { ReportAbuseSheet } from '../moderation/report-abuse-sheet';
import { buildBoardItems, channelState, describeBoardList } from '../notes/note-board-items';
import { NoteCard } from '../notes/note-card';
import { useOffline } from '../offline/offline-provider';
import { forgetBoardCard, queueMutation } from '../offline/pending-mutations';
import { saveViewFailureMessage, seedSavedViewName } from '../views/saved-view-list';

import '../moderation/hide-failure-notice.css';

/**
 * How long the board waits after a keystroke before asking the server again.
 *
 * The comp filters as you type and so does this, but each character is a round trip and
 * a half-typed `type:` is a query the grammar refuses. A quarter of a second is below
 * the threshold where typing feels laggy and above the rate at which anyone types.
 */
const SEARCH_DEBOUNCE_MS = 250;

/** A value that follows `value`, but no faster than once every `delay` milliseconds. */
function useDebounced<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return settled;
}

/**
 * What to tell someone whose board did not load.
 *
 * A refused query is the *only* failure worth interrupting them for, and its message is
 * the server's own — `parseBoardQuery` names the token it could not apply, which is the
 * one thing that lets the person who typed it fix it (ADR-0007:53-56). Everything else
 * is a transport failure, and this app's answer to those is the cache, not a banner.
 */
function boardErrorMessage(error: unknown): string {
  return applicationErrorCode(error) === 'INVALID_BOARD_QUERY' && error instanceof Error
    ? error.message
    : 'The board could not be loaded. Check your connection and try again.';
}

/**
 * The board: what this viewer may see, plus their own posts.
 *
 * The author's own bulletins are unioned in from `bulletins.listMine` rather than
 * relying on the visibility read to include them. Two reasons, and the second is the
 * load-bearing one: an author should see their own posts on their own board, and
 * `archivedAt` — the only observable form of archived-ness — exists solely on that read
 * model. An archived bulletin stays rendered for its author, marked, instead of
 * vanishing; disappearing state is indistinguishable from a bug.
 *
 * ⚠ **A search adds no rows to that union.** `bulletins.board` is the only thing that
 * knows what a query means; unioning an unfiltered `listMine` into a filtered answer would
 * put bulletins on screen that do not match what was asked, which is a broken filter
 * rather than a generous one. A search shows the server's answer and nothing else —
 * including nothing from the offline cache, because a write the server has not seen cannot
 * have been matched against a query it never ran.
 *
 * It does still *correct* the rows the search returned: a bulletin the query matched is
 * the viewer's own if `listMine` says so, whatever the visibility read's projection of it
 * looked like. Leaving that off during a search rendered somebody's own post as a
 * stranger's, under the sheet's "ask them for an intro" hint.
 */
export function BoardRoute(): JSX.Element {
  const api = useApi();
  const queryClient = useQueryClient();
  const { database, syncRunner } = useOffline();
  const [searchParams] = useSearchParams();
  const [hidden, setHidden] = useState<readonly string[]>([]);
  const urlQuery = searchParams.get('q') ?? '';
  // Seeded from `?q=` on mount and re-synced whenever it changes (the effect below) —
  // that is how the Saved screen's "OPEN ON BOARD" arrives (#173). `search` and `filter`
  // both come from this one `parseBoardQueryState` call so they can never drift apart the
  // way they once did: the chip a saved `type:` term selects and the text left in the
  // search box used to be derived separately — the whole query for one, a parse of the
  // same query for the other — so the search box kept the `type:` term that
  // `buildBoardQuery` below was about to add a second time. Typing or clicking a chip
  // never writes back to `?q=`, so re-deriving here can never fight a person's own edit —
  // it only ever reacts to a *new* URL, which is exactly a saved view opening or a
  // browser back/forward landing on a different `?q=`.
  //
  // Lazy initializers, not a plain `useState(urlQuery)`: without them React mounts at the
  // unfiltered state and this comp's query below fetches for it once before the effect
  // below ever runs — one wasted request before the real, `?q=`-derived state lands.
  const initialQueryState = parseBoardQueryState(urlQuery);
  const [search, setSearch] = useState(() => initialQueryState.search);
  const [filter, setFilter] = useState<BoardTypeFilter>(() => initialQueryState.filter);

  useEffect(() => {
    const queryState = parseBoardQueryState(urlQuery);
    setSearch(queryState.search);
    setFilter(queryState.filter);
  }, [urlQuery]);
  const [openBulletinId, setOpenBulletinId] = useState<string | null>(null);
  /*
   * The card being reported, held separately from `openBulletinId`. Reporting hides the
   * bulletin the moment it succeeds, so it leaves `visible` and `openCard` becomes null
   * — and a sheet keyed off the open card would unmount mid-send, taking the reporter's
   * typed account with it. Holding the card is also what lets the sheet quote a title
   * that is no longer on the board.
   */
  const [reporting, setReporting] = useState<BoardCardView | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  const settledSearch = useDebounced(search, SEARCH_DEBOUNCE_MS);
  const query = buildBoardQuery(filter, settledSearch);
  const queryActive = query !== undefined;

  const board = useQuery({
    queryKey: ['bulletins', 'board', query ?? null],
    queryFn: () => api.query('bulletins.board', query === undefined ? {} : { query }),
    // Every edit to the query is a new cache key, and without this the list would empty
    // itself between keystrokes and flash "Nothing matches" at someone who is still
    // typing. The previous answer stays on screen until the next one lands — briefly
    // behind the field, never contradicting it for longer than one round trip.
    placeholderData: keepPreviousData,
  });

  const mine = useQuery({
    queryKey: ['bulletins', 'listMine'],
    queryFn: () => api.query('bulletins.listMine', undefined),
  });

  /*
   * The notes pinned to this viewer's board (#88). No parameter and no viewer id: there
   * is exactly one note list a caller may read, so there is nothing to name
   * (`notes.router.ts`, ADR-0002 §5a).
   *
   * ⚠ Not unioned into `cards`. A note is not a bulletin, has no `type`, no title, and no
   * author-versus-viewer read models to reconcile; `buildBoardItems` orders the two kinds
   * into one list without flattening either into the other's shape.
   */
  const notes = useQuery({
    queryKey: ['notes', 'list'],
    queryFn: () => api.query('notes.list', undefined),
  });

  // The offline cache is unioned in so a card written while offline — or one whose
  // server refetch has not landed yet — is on screen rather than briefly missing.
  const cached = useLiveQuery(() => database.cachedBoard.toArray(), [database], []);

  // ⚠ Saves `query`, the composed text the server was actually asked — chip term
  // included — and not the raw field. A view that stored only what was typed would come
  // back narrowing differently from the board it was saved off, which is the one way a
  // saved view can quietly lie.
  const saveView = useMutation({
    mutationFn: (input: { name: string; sourceText: string }) =>
      api.mutate('views.saved.save', input),
    onSuccess: async () => {
      setSavedNotice('View saved — find it under Saved');
      await queryClient.invalidateQueries({ queryKey: ['views', 'saved', 'list'] });
    },
    // ⚠ The server's refusals are not all the same refusal — see `saveViewFailureMessage`.
    onError: (error: unknown) => {
      setSavedNotice(saveViewFailureMessage(error));
    },
  });

  /*
   * One mutation for both, because both have the same effect on this screen: the
   * bulletin leaves the board, the offline cache forgets it, and every query is
   * invalidated. They differ only in what the server is told — a dismissal says
   * nothing, a report carries the reason and the account the sheet collected.
   *
   * ⚠ **`retry: false` is the app-wide default (`api-provider.tsx`), and neither of
   * these is queued offline** — `bulletin.report` has no replay route, which is what
   * [#63](https://github.com/drewdrewthis/playa-post/issues/63) tracks. So one attempt is
   * all there is, and an offline report fails exactly the way an online refusal does.
   * `onError` is therefore not a nicety: it is the only thing standing between a failed
   * report and a person who believes the stewards have it.
   */
  const hide = useMutation({
    mutationFn: (input: ReportBulletinRequest | ModerationTargetRequest) =>
      'reason' in input
        ? api.mutate('moderation.report', input)
        : api.mutate('moderation.dismiss', input),
    onSuccess: async (_result, input) => {
      await forgetBoardCard(database, input.bulletinId);
      await queryClient.invalidateQueries();
    },
    onError: (error, input) => {
      // A card hidden for a write that never landed is a claim the next reload quietly
      // reverses. Put it back — unless the server's answer was that it is not there,
      // which is the one refusal restoring it would contradict.
      if (describeHideFailure(input, error).restoresCard) {
        setHidden((previous) => previous.filter((id) => id !== input.bulletinId));
      }
    },
  });

  /*
   * The failed hide still on screen, or `null`.
   *
   * Read off the mutation rather than copied into state, because react-query holds the
   * variables of a failed mutation — which means the reporter's own account of what
   * happened survives the failure and can be sent again without being retyped. Starting
   * another hide clears this, so only ever one notice is on screen; the card of an
   * abandoned one is already back on the board, so nothing is lost by that.
   */
  const failedHide = hide.isError && hide.variables !== undefined ? hide.variables : null;
  const hideFailure = failedHide === null ? null : describeHideFailure(failedHide, hide.error);

  async function archive(card: BoardCardView): Promise<void> {
    await queueMutation(database, {
      mutationType: 'bulletin.archive',
      payload: { bulletinId: card.id },
      optimisticCard: {
        kind: 'own',
        bulletin: {
          id: card.id,
          type: card.type,
          title: card.title,
          body: card.body,
          createdAt: card.createdAt,
          loc: card.loc,
          expiresAt: card.expiresAt,
          archivedAt: new Date().toISOString(),
          version: 0,
        },
      },
    });

    await syncRunner.drain();
  }

  const closeSheet = useCallback(() => {
    setOpenBulletinId(null);
  }, []);

  /**
   * Take a card off this board straight away, then tell the server why (or that).
   *
   * ⚠ **The removal is provisional, not a claim.** It holds only while the write is in
   * flight; `hide`'s `onError` puts the card back and the notice below says what did not
   * happen. Hiding unconditionally is what let a failed report leave someone believing
   * the stewards had it.
   */
  function hideBulletin(bulletinId: string, request: ReportBulletinRequest | ModerationTargetRequest): void {
    closeSheet();
    setHidden((previous) => [...previous, bulletinId]);
    hide.mutate(request);
  }

  const cards = new Map<string, BoardCardView>();

  for (const item of board.data?.items ?? []) {
    cards.set(item.id, {
      id: item.id,
      type: item.type,
      title: item.title,
      body: item.body,
      createdAt: item.createdAt,
      loc: item.loc,
      expiresAt: item.expiresAt,
      own: false,
      archived: false,
      author: item.author,
    });
  }

  if (!queryActive) {
    for (const row of cached) {
      if (row.card.kind !== 'own') {
        continue;
      }

      const bulletin = row.card.bulletin;

      cards.set(bulletin.id, {
        id: bulletin.id,
        type: bulletin.type,
        title: bulletin.title,
        body: bulletin.body,
        createdAt: bulletin.createdAt,
        loc: bulletin.loc,
        expiresAt: bulletin.expiresAt,
        own: true,
        archived: bulletin.archivedAt !== null,
      });
    }
  }

  /*
   * Last, so the server's own-view wins over any optimistic copy of the same row.
   *
   * ⚠ **Runs during a search too, but only over rows the query already returned.** The
   * `continue` is what keeps a search honest: an unfiltered `listMine` folded into a
   * filtered answer would show bulletins that do not match what was asked. A bulletin the
   * search *did* match is a different thing — it is on screen either way, and rendering it
   * as somebody else's puts the intro hint under the viewer's own post.
   */
  for (const bulletin of mine.data ?? []) {
    if (queryActive && !cards.has(bulletin.id)) {
      continue;
    }

    cards.set(bulletin.id, {
      id: bulletin.id,
      type: bulletin.type,
      title: bulletin.title,
      body: bulletin.body,
      createdAt: bulletin.createdAt,
      loc: bulletin.loc,
      expiresAt: bulletin.expiresAt,
      own: true,
      archived: bulletin.archivedAt !== null,
    });
  }

  const visible = [...cards.values()]
    .filter((card) => !hidden.includes(card.id))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  // Bulletins and notes in one column, newest first — and no notes at all while a query
  // is active, because nothing a person writes in a note is searchable and a client that
  // matched them locally would be inventing the grammar the server refused to build.
  const items = buildBoardItems({ cards: visible, notes: notes.data ?? [], queryActive });

  /*
   * ⚠ What the list region may *claim*, decided outside the JSX so it can be asserted
   * without a DOM. `notes.isError` used to go unread here, which turned a failed
   * `notes.list` into "Nothing on your board yet. Quiet playa." — a private message
   * somebody left, reported as a quiet playa.
   */
  const region = describeBoardList({
    itemCount: items.length,
    queryActive,
    board: channelState(board),
    notes: channelState(notes),
  });

  // One clock reading per render, shared by every card and the sheet, so no two ages on
  // screen are measured against different moments. Nothing re-reads it on a timer: the
  // board refetches often enough that a minute's drift on an idle screen is invisible
  // at this granularity.
  const now = new Date();
  const openCard = visible.find((card) => card.id === openBulletinId) ?? null;

  return (
    <section className="screen" data-testid="board">
      {/* Composing is the shell's FAB now, on every screen — see `tab-bar.tsx`. */}
      <h1 className="sr-only">The board</h1>

      <BoardSearch
        search={search}
        onSearchChange={setSearch}
        filter={filter}
        onFilterChange={setFilter}
        // ⚠ Bulletins matched, not rows on screen: a search never reaches a note, so
        // counting them would report matches against a query they were never tested by.
        matchCount={board.isSuccess ? visible.length : null}
        saving={saveView.isPending}
        // ⚠ The *settled* query, not the raw field. `BoardSearch` knows a query is being
        // typed; only this route knows whether one has composed yet, because only it holds
        // the debounce. Without this the control is live for ~250ms doing nothing.
        settledQueryActive={queryActive}
        onSave={() => {
          if (query === undefined) {
            return;
          }
          setSavedNotice(null);
          saveView.mutate({ name: seedSavedViewName(query), sourceText: query });
        }}
      />

      {/*
       * ⚠ **Persistent, not a toast.** Every other confirmation on this app borrows the
       * comp's `say()` pill, which fades after 2400ms — right for "Posted", wrong here.
       * The comp has no failure state at all (`sendReport` cannot fail against a mock),
       * so nothing is being contradicted; but a notice that leaves on its own is one a
       * person can miss, and missing it returns them to believing a report was filed.
       * It goes when they say so, or when the retry succeeds.
       */}
      {hideFailure === null ? null : (
        <div className="hide-failure" role="alert" data-testid="hide-failure">
          <p className="hide-failure__message">{hideFailure.message}</p>

          {/*
           * The retry is `screens.css`'s own `button--quiet` — the app's pill for a
           * row-level action, borrowed rather than restyled. It re-sends `failedHide`,
           * the exact request react-query held onto, so the reporter's account of what
           * happened goes again without being retyped.
           */}
          <div className="hide-failure__actions">
            {/* Absent, not dimmed, when a retry cannot work — see `hide-failure.ts`. */}
            {hideFailure.retryable && failedHide !== null ? (
              <button
                className="button button--quiet"
                data-testid="hide-failure-retry-button"
                type="button"
                onClick={() => {
                  hide.mutate(failedHide);
                }}
              >
                Try again
              </button>
            ) : null}

            <button
              className="hide-failure__dismiss"
              data-testid="hide-failure-dismiss-button"
              type="button"
              onClick={() => {
                hide.reset();
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/*
       * `screen__notice` rather than a new class: this is the shared "small line of prose
       * under the controls" treatment, and a second one would be a second thing to keep
       * in sync.
       */}
      {savedNotice === null ? null : (
        <p className="screen__notice" data-testid="board-save-view-notice" role="status">
          {savedNotice}
        </p>
      )}

      {region.boardError ? (
        <p className="form__error" data-testid="board-error">
          {boardErrorMessage(board.error)}
        </p>
      ) : (
        <>
          {/*
           * `.form__error`, sitting beside the refused-query line above and reading the
           * same way, because it is the same kind of thing: a read that did not answer.
           * `role="status"` rather than `alert` — the bulletins under it are still worth
           * reading, and this is not an interruption.
           */}
          {region.notesFailure === null ? null : (
            <p className="form__error" data-testid="board-notes-error" role="status">
              {region.notesFailure}
            </p>
          )}

          {region.empty === null ? null : <p className="screen__empty">{region.empty}</p>}

          {region.items ? (
            <ul className="board-list">
              {items.map((item) => (
                <li key={item.key}>
                  {item.kind === 'note' ? (
                    /* No `onOpen`: a note carries its whole text on the card and there is
                       no `notes.getById` to open — see `notes/note-card.tsx`. */
                    <NoteCard note={item.note} now={now} />
                  ) : (
                    <BulletinCard
                      card={item.card}
                      now={now}
                      onOpen={(opened) => {
                        setOpenBulletinId(opened.id);
                      }}
                    />
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}

      {/*
       * Keyed off the card still being on screen rather than off the id alone: a
       * bulletin dismissed from inside the sheet leaves `visible`, `openCard` becomes
       * null, and the sheet closes itself instead of describing something that is gone.
       */}
      {openCard === null ? null : (
        <BulletinDetailSheet
          card={openCard}
          now={now}
          onClose={closeSheet}
          onArchive={(card) => {
            closeSheet();
            void archive(card);
          }}
          onDismiss={(card) => {
            hideBulletin(card.id, { bulletinId: card.id });
          }}
          /*
           * Reporting no longer fires on the button. It opens the sheet that asks what
           * kind and what happened, because a report with no reason is a row the
           * stewards cannot act on (`design/Playa Post.dc.html:337-356`).
           */
          onReport={(card) => {
            closeSheet();
            setReporting(card);
          }}
        />
      )}

      {reporting === null ? null : (
        <ReportAbuseSheet
          bulletinId={reporting.id}
          bulletinTitle={reporting.title}
          onClose={() => {
            setReporting(null);
          }}
          onSend={(report) => {
            setReporting(null);
            hideBulletin(report.bulletinId, report);
          }}
        />
      )}
    </section>
  );
}

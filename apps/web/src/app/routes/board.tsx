import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useState, type JSX } from 'react';

import { useApi } from '../api/api-provider';
import { applicationErrorCode } from '../api/client';
import type { BoardCardView } from '../bulletins/board-card-view';
import { buildBoardQuery, type BoardTypeFilter } from '../bulletins/board-query';
import { BoardSearch } from '../bulletins/board-search';
import { BulletinCard } from '../bulletins/bulletin-card';
import { BulletinDetailSheet } from '../bulletins/bulletin-detail-sheet';
import { useOffline } from '../offline/offline-provider';
import { forgetBoardCard, queueMutation } from '../offline/pending-mutations';

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
 * ⚠ **That union is skipped the moment a query is active.** `bulletins.board` is the
 * only thing that knows what a query means; unioning an unfiltered `listMine` into a
 * filtered answer would put bulletins on screen that do not match what was asked, which
 * is a broken filter rather than a generous one. A search shows the server's answer and
 * nothing else — including nothing from the offline cache, because a write the server
 * has not seen cannot have been matched against a query it never ran.
 */
export function BoardRoute(): JSX.Element {
  const api = useApi();
  const queryClient = useQueryClient();
  const { database, syncRunner } = useOffline();
  const [hidden, setHidden] = useState<readonly string[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<BoardTypeFilter>('all');
  const [openBulletinId, setOpenBulletinId] = useState<string | null>(null);

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

  // The offline cache is unioned in so a card written while offline — or one whose
  // server refetch has not landed yet — is on screen rather than briefly missing.
  const cached = useLiveQuery(() => database.cachedBoard.toArray(), [database], []);

  const hide = useMutation({
    mutationFn: (input: { bulletinId: string; action: 'dismiss' | 'report' }) =>
      input.action === 'report'
        ? api.mutate('moderation.report', { bulletinId: input.bulletinId })
        : api.mutate('moderation.dismiss', { bulletinId: input.bulletinId }),
    onSuccess: async (_result, input) => {
      await forgetBoardCard(database, input.bulletinId);
      await queryClient.invalidateQueries();
    },
  });

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

  function hideBulletin(card: BoardCardView, action: 'dismiss' | 'report'): void {
    closeSheet();
    setHidden((previous) => [...previous, card.id]);
    hide.mutate({ bulletinId: card.id, action });
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

    // Last, so the server's own-view wins over any optimistic copy of the same row.
    for (const bulletin of mine.data ?? []) {
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

  const visible = [...cards.values()]
    .filter((card) => !hidden.includes(card.id))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  // One clock reading per render, shared by every card and the sheet, so no two ages on
  // screen are measured against different moments. Nothing re-reads it on a timer: the
  // board refetches often enough that a minute's drift on an idle screen is invisible
  // at this granularity.
  const now = new Date();
  const openCard = visible.find((card) => card.id === openBulletinId) ?? null;

  return (
    <section className="screen" data-testid="board">
      {/* Composing is the shell's FAB now, on every screen — see `tab-bar.tsx`. */}
      <header className="screen__header">
        <h1 className="screen__title">The board</h1>
      </header>

      <BoardSearch
        search={search}
        onSearchChange={setSearch}
        filter={filter}
        onFilterChange={setFilter}
        matchCount={board.isSuccess ? visible.length : null}
      />

      {queryActive && board.isError ? (
        <p className="form__error" data-testid="board-error">
          {boardErrorMessage(board.error)}
        </p>
      ) : visible.length === 0 ? (
        <p className="screen__empty">
          {queryActive ? 'Nothing matches. Quiet playa.' : 'Nothing on your board yet. Quiet playa.'}
        </p>
      ) : (
        <ul className="board-list">
          {visible.map((card) => (
            <li key={card.id}>
              <BulletinCard
                card={card}
                now={now}
                onOpen={(opened) => {
                  setOpenBulletinId(opened.id);
                }}
              />
            </li>
          ))}
        </ul>
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
            hideBulletin(card, 'dismiss');
          }}
          onReport={(card) => {
            hideBulletin(card, 'report');
          }}
        />
      )}
    </section>
  );
}

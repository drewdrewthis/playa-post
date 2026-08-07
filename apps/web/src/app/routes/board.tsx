import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type JSX } from 'react';

import type { BulletinAuthor } from '@playa-post/contracts';

import { useApi } from '../api/api-provider';
import { useOffline } from '../offline/offline-provider';
import { forgetBoardCard, queueMutation } from '../offline/pending-mutations';
import { PersonIdentity } from '../people/person-identity';

/**
 * One bulletin as this screen renders it.
 *
 * `own` and `archived` come from `bulletins.listMine` (the author's read model, the
 * only one carrying `archivedAt`); `author` comes from `bulletins.board` (the eligible
 * viewer's read model, the only one carrying the §6a author card). Neither read model
 * has both, and this view keeps them side by side rather than inventing a merged
 * server type.
 */
interface BoardCardView {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly body: string;
  readonly createdAt: string;
  /**
   * Carried, not yet rendered. The card's `◦ {loc} · {author}` meta line is issue #46's
   * work; this view holds the two fields anyway because the optimistic-archive path
   * below rebuilds a whole `Bulletin` from a card, and a field this view dropped would
   * come back as `null` in the offline cache — a silent edit to somebody's own post.
   */
  readonly loc: string | null;
  readonly expiresAt: string | null;
  readonly own: boolean;
  readonly archived: boolean;
  readonly author?: BulletinAuthor;
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
 */
export function BoardRoute(): JSX.Element {
  const api = useApi();
  const queryClient = useQueryClient();
  const { database, syncRunner } = useOffline();
  const [hidden, setHidden] = useState<readonly string[]>([]);

  const board = useQuery({
    queryKey: ['bulletins', 'board'],
    queryFn: () => api.query('bulletins.board', {}),
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

  async function archive(bulletinId: string, card: BoardCardView): Promise<void> {
    await queueMutation(database, {
      mutationType: 'bulletin.archive',
      payload: { bulletinId },
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

  const visible = [...cards.values()]
    .filter((card) => !hidden.includes(card.id))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  return (
    <section className="screen" data-testid="board">
      {/* Composing is the shell's FAB now, on every screen — see `tab-bar.tsx`. */}
      <header className="screen__header">
        <h1 className="screen__title">The board</h1>
      </header>

      {visible.length === 0 ? (
        <p className="screen__empty">Nothing on your board yet. Quiet playa.</p>
      ) : (
        <ul className="board-list">
          {visible.map((card) => (
            <li key={card.id}>
              {/*
                `data-type` drives the per-type tint in `screens.css`. A type with no
                rule of its own still renders a tag, in the accent, rather than an
                untinted one.
              */}
              <article
                className="bulletin-card"
                data-testid={`board-bulletin-card-${card.id}`}
                data-archived={card.archived ? 'true' : 'false'}
                data-type={card.type}
              >
                <p className="bulletin-card__type">{card.type}</p>
                <h2 className="bulletin-card__title">{card.title}</h2>
                <p className="bulletin-card__body">{card.body}</p>

                {card.author === undefined ? null : (
                  <p className="bulletin-card__author">
                    <PersonIdentity identity={card.author} />
                  </p>
                )}

                {card.archived ? <p className="bulletin-card__archived">Archived</p> : null}

                <div className="bulletin-card__actions">
                  {card.own ? (
                    <button
                      className="button button--quiet"
                      data-testid="bulletin-archive-button"
                      type="button"
                      disabled={card.archived}
                      onClick={() => {
                        void archive(card.id, card);
                      }}
                    >
                      Archive
                    </button>
                  ) : (
                    <>
                      <button
                        className="button button--quiet"
                        data-testid="bulletin-dismiss-button"
                        type="button"
                        onClick={() => {
                          setHidden((previous) => [...previous, card.id]);
                          hide.mutate({ bulletinId: card.id, action: 'dismiss' });
                        }}
                      >
                        Dismiss
                      </button>
                      <button
                        className="button button--quiet"
                        data-testid="bulletin-report-button"
                        type="button"
                        onClick={() => {
                          setHidden((previous) => [...previous, card.id]);
                          hide.mutate({ bulletinId: card.id, action: 'report' });
                        }}
                      >
                        Report
                      </button>
                    </>
                  )}
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

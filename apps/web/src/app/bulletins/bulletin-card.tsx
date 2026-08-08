import type { JSX } from 'react';

import { PersonIdentity } from '../people/person-identity';

import type { BoardCardView } from './board-card-view';
import { relativeTime } from './relative-time';

import './bulletin-card.css';

/**
 * One bulletin on the board, in the comp's anatomy.
 *
 * Top to bottom: a dashed type badge tinted per type, the age right-aligned on the same
 * line, the title in the serif display face, and a `◦ {loc} · {author}` meta line
 * (`design/Playa Post.dc.html` lines 104-112).
 *
 * **The body is not here.** The comp's card is a headline and a tap target; the full
 * text lives in the detail sheet the tap opens. A card that already showed everything
 * would leave the sheet with nothing to be.
 *
 * The whole card is one button rather than a `<div>` with a click handler: opening a
 * bulletin has to work from a keyboard, and a button is the element that already does.
 * Its accessible name is the card's own content, which is exactly what someone needs to
 * hear before deciding whether to open it.
 */
export function BulletinCard({
  card,
  now,
  onOpen,
}: {
  readonly card: BoardCardView;
  /**
   * The moment ages are measured against, passed in rather than read here so every
   * card on one render agrees and `relativeTime` stays pure.
   */
  readonly now: Date;
  readonly onOpen: (card: BoardCardView) => void;
}): JSX.Element {
  const age = relativeTime(card.createdAt, now);
  const author = card.author;

  return (
    /*
     * `data-type` drives the per-type tint (`screens.css`). A type with no rule of its
     * own still renders a badge, in the accent, rather than an untinted one.
     */
    <article
      className="bulletin-card"
      data-testid={`board-bulletin-card-${card.id}`}
      data-archived={card.archived ? 'true' : 'false'}
      data-type={card.type}
    >
      <button
        className="bulletin-card__open"
        data-testid="bulletin-open-button"
        type="button"
        onClick={() => {
          onOpen(card);
        }}
      >
        <span className="bulletin-card__header">
          <span className="bulletin-card__type">{card.type}</span>

          {/* The comp's pill slot. Archived is the only state this app has to put in it. */}
          {card.archived ? <span className="bulletin-card__archived">Archived</span> : null}

          {age === null ? null : <span className="bulletin-card__time">{age}</span>}
        </span>

        <span className="bulletin-card__title">{card.title}</span>

        {/*
         * ⚠ Every part of the meta line is conditional, and none of it has a fallback.
         * A bulletin with no location renders no `◦` and no empty slot; one whose author
         * §6a withheld renders `PersonIdentity`'s private treatment. The separator only
         * exists when there is something on both sides of it.
         */}
        {card.loc === null && author === undefined ? null : (
          <span className="bulletin-card__meta">
            {card.loc === null ? null : <span>◦ {card.loc}</span>}
            {card.loc !== null && author !== undefined ? (
              <span aria-hidden="true">·</span>
            ) : null}
            {author === undefined ? null : <PersonIdentity identity={author} />}
          </span>
        )}
      </button>
    </article>
  );
}

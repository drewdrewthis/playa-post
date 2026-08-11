import type { Bulletin, VisibleBulletin } from '@playa-post/contracts';

import { applicationErrorCode } from '../api/client';
import type { BoardChannel } from '../notes/note-board-items';

import type { BoardCardView } from './board-card-view';

/**
 * Which of the board's two lists is on screen (#170).
 *
 * **A view, not a filter term, and the distinction is load-bearing.** `board-query.ts`
 * states that this app has no grammar of its own; a `dismissed:` term would be one, and
 * it would also be a term a saved view could store, which would make one person's
 * private dismissals part of a query they can name and re-open. Dismissal is a fact about
 * a viewer's relationship to a bulletin, not a property of the bulletin, so it addresses
 * a different server read (`bulletins.dismissed`) rather than narrowing the same one.
 */
export const BOARD_VIEW = {
  board: 'board',
  dismissed: 'dismissed',
} as const;

/** One of {@link BOARD_VIEW}'s values. */
export type BoardView = (typeof BOARD_VIEW)[keyof typeof BOARD_VIEW];

/**
 * Read `?view=` as a view, defaulting to the board.
 *
 * ⚠ **Anything unrecognised is the board**, including an absent parameter and a typo.
 * A URL is something people edit and share; refusing one would be an error screen over a
 * question that has an obvious answer, and guessing "dismissed" from a near-miss would
 * open somebody's private list because they mistyped.
 */
export function parseBoardView(raw: string | null): BoardView {
  return raw === BOARD_VIEW.dismissed ? BOARD_VIEW.dismissed : BOARD_VIEW.board;
}

/**
 * The Dismissed category's rows, with the viewer's own posts marked as theirs.
 *
 * ⚠ **`bulletins.dismissed` alone cannot say whose a bulletin is**, and a viewer may
 * dismiss their own post — the dismiss use case permits it, and the visibility traversal
 * this category composes seeds at the viewer. Rendering one of those as a stranger's puts
 * the sheet's "pin them a note / ask for an intro" controls under somebody's own bulletin,
 * addressed to themselves. Own-ness is therefore merged in from `bulletins.listMine` by
 * identifier, exactly as the board does it, rather than by comparing the §6a author card's
 * `userId` — the author card is a disclosure and may legitimately withhold everything.
 *
 * ⚠ **An own row carries no author card**, matching the board's own rows: `listMine` has
 * none, and the sheet resolves that absence to "You". Keeping the §6a projection of
 * oneself would render a person their own name where every other surface says "You".
 *
 * `archived` is `false` throughout: an archived bulletin has already left
 * `app.visible_bulletins`, so it cannot reach this list at all.
 */
export function buildDismissedCards(input: {
  readonly dismissed: readonly VisibleBulletin[];
  readonly mine: readonly Bulletin[];
}): readonly BoardCardView[] {
  const ownIds = new Set(input.mine.map((bulletin) => bulletin.id));

  return input.dismissed.map((item) => {
    const card = {
      id: item.id,
      type: item.type,
      title: item.title,
      body: item.body,
      createdAt: item.createdAt,
      loc: item.loc,
      expiresAt: item.expiresAt,
      archived: false,
    };

    return ownIds.has(item.id)
      ? { ...card, own: true }
      : { ...card, own: false, author: item.author };
  });
}

/** What the Dismissed list may claim about itself. */
export interface DismissedRegion {
  /** Render the rows. False while nothing is known, and while the read failed. */
  readonly items: boolean;
  /** A line explaining a read that did not answer, or `null`. */
  readonly error: string | null;
  /** The empty line, or `null` when rows are on screen or nothing is settled yet. */
  readonly empty: string | null;
}

const DISMISSED_UNAVAILABLE =
  'Your dismissed posts could not be loaded. Check your connection and try again.';

/**
 * What the Dismissed list is allowed to say, decided outside the JSX so it can be
 * asserted without a DOM (`apps/web`'s unit project runs in `environment: 'node'`).
 *
 * ⚠ **A failed read is never "nothing dismissed".** It is the same trap
 * `describeBoardList` records for a failed `notes.list`: a read that did not answer looks
 * exactly like an empty one, and reporting it as empty tells somebody their dismissals
 * are gone. Pending is also not empty — nothing is known yet, so nothing is claimed.
 */
export function describeDismissedList(input: {
  readonly itemCount: number;
  readonly dismissed: BoardChannel;
}): DismissedRegion {
  if (input.dismissed === 'error') {
    return { items: false, error: DISMISSED_UNAVAILABLE, empty: null };
  }

  if (input.itemCount > 0) {
    return { items: true, error: null, empty: null };
  }

  return {
    items: false,
    error: null,
    empty:
      input.dismissed === 'pending'
        ? null
        : 'Nothing dismissed. Anything you take off your board shows up here.',
  };
}

/** What the Dismissed list says about an un-dismissal that did not land, and what it offers. */
export interface UndismissFailureNotice {
  /** Ready to render. Never a bare code. */
  readonly message: string;
  /**
   * Whether re-sending the identical request could succeed.
   *
   * True only for failures the request itself did not cause. A refusal the server has
   * already judged comes back `false`, because a "Try again" over it cannot work.
   */
  readonly retryable: boolean;
}

/**
 * The bulletin is gone, archived, or is no longer visible to this viewer.
 *
 * ⚠ **A mirror of the server's constant, not the rule** — the same relationship
 * `hide-failure.ts`'s copy has. `no-web-to-server-internals` forbids importing it and
 * `packages/contracts` publishes shapes rather than codes; drift falls through to the
 * unknown-refusal line, which is wrong-looking rather than wrong.
 */
const TARGET_UNAVAILABLE = 'MODERATION_TARGET_UNAVAILABLE';

/**
 * Read a failed `moderation.undismiss` as something to say to the person who asked for it.
 *
 * ⚠ **The card stays in the Dismissed list on every failure**, which is why there is no
 * `restoresCard` here to match {@link import('../moderation/hide-failure').HideFailureNotice}'s.
 * Dismissing hides a card optimistically and therefore has something to put back;
 * un-dismissing has nothing to undo until the server agrees, so this list is only ever
 * refetched on success. Stating that as a missing field rather than a `false` one keeps a
 * caller from looking for a branch that does not exist.
 */
export function describeUndismissFailure(error: unknown): UndismissFailureNotice {
  const code = applicationErrorCode(error);

  if (code === null) {
    // No application code at all: the request never reached a verdict. Retrying the same
    // request is exactly the right offer.
    return {
      message: 'That did not reach the server. Check your connection and try again.',
      retryable: true,
    };
  }

  if (code === TARGET_UNAVAILABLE) {
    // The one refusal with a remedy worth naming, and the common one: the author removed
    // the bulletin, or it is no longer reachable. There is nothing to put back.
    return {
      message: 'That post is no longer available, so it cannot go back on your board.',
      retryable: false,
    };
  }

  return { message: `That could not be undone (${code}).`, retryable: false };
}

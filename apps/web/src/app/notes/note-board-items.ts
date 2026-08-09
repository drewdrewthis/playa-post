import type { Note } from '@playa-post/contracts';

import type { BoardCardView } from '../bulletins/board-card-view';

/**
 * One row of the board: a bulletin anybody eligible can see, or a note only this viewer
 * can (issue #88).
 *
 * `key` and `createdAt` are lifted out of both so the list can be ordered and keyed
 * without narrowing first — and so a note id and a bulletin id, which come from two
 * tables and are compared nowhere else, can never collide into one React key.
 */
export type BoardItem =
  | {
      readonly kind: 'bulletin';
      readonly key: string;
      readonly createdAt: string;
      readonly card: BoardCardView;
    }
  | {
      readonly kind: 'note';
      readonly key: string;
      readonly createdAt: string;
      readonly note: Note;
    };

export interface BoardItemsInput {
  readonly cards: readonly BoardCardView[];
  /** `notes.list` — the notes pinned to *this* viewer's board, and nobody else's. */
  readonly notes: readonly Note[];
  /**
   * Whether the board is showing a search rather than everything.
   *
   * ⚠ **A search shows no notes at all.** Notes carry no `search_document` and the
   * server has no query grammar over them, deliberately, so that nothing a person writes
   * in one can become a way to find them (`packages/contracts/src/notes.ts`). A client
   * that filtered them locally would be building exactly that grammar — the one the
   * server refused to build — and would put rows on screen that the server's answer to
   * the query never contained.
   */
  readonly queryActive: boolean;
}

/**
 * Interleave the viewer's notes into their board, newest first.
 *
 * One list rather than two sections: a note is a thing somebody left for you, and the
 * board is where things people leave for you are. Filing them separately would make the
 * board a place you have to remember to check twice.
 *
 * Ties keep their input order — `Array.prototype.sort` is stable — so two rows written in
 * the same millisecond do not swap places between renders.
 */
export function buildBoardItems(input: BoardItemsInput): readonly BoardItem[] {
  const items: BoardItem[] = input.cards.map((card) => ({
    kind: 'bulletin',
    key: `bulletin:${card.id}`,
    createdAt: card.createdAt,
    card,
  }));

  if (!input.queryActive) {
    for (const note of input.notes) {
      items.push({ kind: 'note', key: `note:${note.id}`, createdAt: note.createdAt, note });
    }
  }

  return items.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

/**
 * What the board says when the private channel did not answer.
 *
 * ⚠ **It says the notes are still there**, because they are: `notes.list` failing is this
 * device not having read them, and nothing about a note stops existing when a request
 * does. It also names no gesture — this screen has no pull-to-refresh — so it asks for the
 * one thing that does work, in the same words `boardErrorMessage` uses for the same kind
 * of failure.
 */
export const NOTES_UNAVAILABLE =
  'Your notes could not be loaded. They are still there — check your connection and try again.';

/** How far a read this list is built from has got. */
export type BoardChannel = 'pending' | 'error' | 'settled';

export interface BoardListInput {
  /** Rows {@link buildBoardItems} produced — bulletins, notes, and the offline cache. */
  readonly itemCount: number;
  readonly queryActive: boolean;
  /** `bulletins.board`. The only read a search has, so the only one a search waits on. */
  readonly board: BoardChannel;
  /** `notes.list` — the private channel, which a search deliberately never reads. */
  readonly notes: BoardChannel;
}

/** What the list region of the board shows. Each part renders, or does not. */
export interface BoardListRegion {
  /** The refused-query line. Nothing else renders beside it. */
  readonly boardError: boolean;
  /** Whether there are rows to render. */
  readonly items: boolean;
  /** The private channel's failure line, or `null`. */
  readonly notesFailure: string | null;
  /** The "nothing here" line, or `null` — absent whenever emptiness is not yet known. */
  readonly empty: string | null;
}

/**
 * Decide what the board's list region shows, from how far each read has got.
 *
 * ⚠ **Emptiness is a claim, and this is the only place allowed to make it.** "Nothing on
 * your board yet. Quiet playa." is a statement about the world; rendering it because a
 * read has not landed, or because one failed, tells somebody their board is empty when
 * what actually happened is that nobody looked. A private note the viewer never learns
 * arrived is the worst version of that, which is why a failed `notes.list` gets a line of
 * its own rather than being swallowed into an empty state.
 *
 * The bulletins still render underneath it: one channel failing is not a reason to
 * withhold the other.
 */
export function describeBoardList(input: BoardListInput): BoardListRegion {
  // A refused query is the one failure worth interrupting for — its message names the
  // token the server could not apply, which is what lets the person who typed it fix it.
  if (input.queryActive && input.board === 'error') {
    return { boardError: true, items: false, notesFailure: null, empty: null };
  }

  // Silent during a search, because a search shows no notes at all: a line about a
  // channel that is not on screen is noise about something the viewer cannot act on.
  const notesFailed = !input.queryActive && input.notes === 'error';

  return {
    boardError: false,
    items: input.itemCount > 0,
    notesFailure: notesFailed ? NOTES_UNAVAILABLE : null,
    empty: emptyLine(input, notesFailed),
  };
}

function emptyLine(input: BoardListInput, notesFailed: boolean): string | null {
  // Rows on screen answer the question already.
  if (input.itemCount > 0) {
    return null;
  }

  // Nothing has come back yet, so nothing is known — including whether this is empty.
  if (input.board === 'pending' || (!input.queryActive && input.notes === 'pending')) {
    return null;
  }

  // A channel that failed is not a channel that came back empty, and the failure line
  // above is already accounting for it.
  if (notesFailed) {
    return null;
  }

  return input.queryActive
    ? 'Nothing matches. Quiet playa.'
    : 'Nothing on your board yet. Quiet playa.';
}

/**
 * Read a react-query result as a {@link BoardChannel}.
 *
 * `isPending` means no answer at all — with `placeholderData` in play a refetch keeps the
 * previous one, and a board that still has rows to show is not waiting on anything.
 */
export function channelState(query: {
  readonly isPending: boolean;
  readonly isError: boolean;
}): BoardChannel {
  if (query.isError) {
    return 'error';
  }

  return query.isPending ? 'pending' : 'settled';
}

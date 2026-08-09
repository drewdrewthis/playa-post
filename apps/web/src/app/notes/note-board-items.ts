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

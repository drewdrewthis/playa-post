import { describe, expect, it } from 'vitest';

import type { Note } from '@playa-post/contracts';

import type { BoardCardView } from '../bulletins/board-card-view';

import { buildBoardItems } from './note-board-items';

function bulletin(id: string, createdAt: string): BoardCardView {
  return {
    id,
    type: 'request',
    title: `Bulletin ${id}`,
    body: 'body',
    createdAt,
    loc: null,
    expiresAt: null,
    own: false,
    archived: false,
  };
}

function note(id: string, createdAt: string): Note {
  return {
    id,
    body: 'Come find me at the pavilion.',
    createdAt,
    author: { userId: 'user-1', disclosure: 'full', displayName: 'Lena' },
  };
}

describe('buildBoardItems', () => {
  it('interleaves notes among bulletins, newest first', () => {
    const items = buildBoardItems({
      cards: [bulletin('b1', '2026-08-09T12:00:00.000Z'), bulletin('b2', '2026-08-09T08:00:00.000Z')],
      notes: [note('n1', '2026-08-09T10:00:00.000Z'), note('n2', '2026-08-09T06:00:00.000Z')],
      queryActive: false,
    });

    expect(items.map((item) => item.key)).toEqual([
      'bulletin:b1',
      'note:n1',
      'bulletin:b2',
      'note:n2',
    ]);
  });

  it('keeps each row’s subject with it, so the list needs no second lookup', () => {
    const card = bulletin('b1', '2026-08-09T12:00:00.000Z');
    const pinned = note('n1', '2026-08-09T10:00:00.000Z');

    const [first, second] = buildBoardItems({ cards: [card], notes: [pinned], queryActive: false });

    expect(first).toEqual({
      kind: 'bulletin',
      key: 'bulletin:b1',
      createdAt: card.createdAt,
      card,
    });
    expect(second).toEqual({
      kind: 'note',
      key: 'note:n1',
      createdAt: pinned.createdAt,
      note: pinned,
    });
  });

  /*
   * ⚠ The invariant, not a preference. Notes carry no `search_document` and the server
   * has no query grammar over them, precisely so that nothing written in one becomes a
   * way to find somebody. A client that matched them locally would build that grammar
   * after the server refused to — and would show rows the server's answer never held.
   */
  it('shows no notes at all while a search is active', () => {
    const items = buildBoardItems({
      cards: [bulletin('b1', '2026-08-09T12:00:00.000Z')],
      notes: [note('n1', '2026-08-09T13:00:00.000Z')],
      queryActive: true,
    });

    expect(items.map((item) => item.key)).toEqual(['bulletin:b1']);
  });

  it('is empty when there is neither, rather than carrying an empty row', () => {
    expect(buildBoardItems({ cards: [], notes: [], queryActive: false })).toEqual([]);
  });

  it('renders a board of notes alone, for somebody whose bulletins have all expired', () => {
    const items = buildBoardItems({
      cards: [],
      notes: [note('n1', '2026-08-09T10:00:00.000Z')],
      queryActive: false,
    });

    expect(items.map((item) => item.kind)).toEqual(['note']);
  });

  // A note id and a bulletin id come from two tables and are compared nowhere else. The
  // prefix is what stops one colliding with the other into a single React key.
  it('keys a note and a bulletin sharing an id as two different rows', () => {
    const items = buildBoardItems({
      cards: [bulletin('same', '2026-08-09T12:00:00.000Z')],
      notes: [note('same', '2026-08-09T11:00:00.000Z')],
      queryActive: false,
    });

    expect(new Set(items.map((item) => item.key)).size).toBe(2);
  });

  // Stable sort: two rows written in the same millisecond must not swap between renders.
  it('holds a tie in input order rather than shuffling it', () => {
    const at = '2026-08-09T12:00:00.000Z';
    const keys = (): readonly string[] =>
      buildBoardItems({
        cards: [bulletin('b1', at), bulletin('b2', at)],
        notes: [note('n1', at)],
        queryActive: false,
      }).map((item) => item.key);

    expect(keys()).toEqual(['bulletin:b1', 'bulletin:b2', 'note:n1']);
    expect(keys()).toEqual(keys());
  });
});

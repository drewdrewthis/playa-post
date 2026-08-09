import { describe, expect, it } from 'vitest';

import type { Note } from '@playa-post/contracts';

import type { BoardCardView } from '../bulletins/board-card-view';

import {
  buildBoardItems,
  channelState,
  describeBoardList,
  NOTES_UNAVAILABLE,
  type BoardListInput,
  type BoardListRegion,
} from './note-board-items';

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

  /*
   * §6a lets the author of a note stop being someone this viewer may be told about. The
   * note survives, unnamed — so a row still has to be built for it.
   */
  it('keeps a note whose author is no longer disclosed', () => {
    const anonymous: Note = {
      id: 'n1',
      body: 'Come find me at the pavilion.',
      createdAt: '2026-08-09T10:00:00.000Z',
    };

    expect(
      buildBoardItems({ cards: [], notes: [anonymous], queryActive: false }).map((item) => item.key),
    ).toEqual(['note:n1']);
  });
});

describe('describeBoardList', () => {
  const region = (over: Partial<BoardListInput> = {}): BoardListRegion =>
    describeBoardList({
      itemCount: 0,
      queryActive: false,
      board: 'settled',
      notes: 'settled',
      ...over,
    });

  describe('while the reads are still out', () => {
    /*
     * ⚠ The failure this exists to stop: "Nothing on your board yet" rendered at somebody
     * whose notes had simply not arrived. Emptiness is a claim about the world, and
     * nothing has come back to make it with.
     */
    it('claims nothing while notes are still loading and there is nothing cached', () => {
      expect(region({ notes: 'pending' }).empty).toBeNull();
    });

    it('claims nothing while the board itself is still loading', () => {
      expect(region({ board: 'pending' }).empty).toBeNull();
    });

    it('says nothing at all rather than a half-answer', () => {
      expect(region({ notes: 'pending' })).toEqual({
        boardError: false,
        items: false,
        notesFailure: null,
        empty: null,
      });
    });

    /* A cached card is an answer, even before the server's. */
    it('renders the rows it already has instead of waiting', () => {
      expect(region({ notes: 'pending', itemCount: 2 }).items).toBe(true);
    });
  });

  describe('when notes.list fails', () => {
    it('says so, in words that do not claim the notes are gone', () => {
      expect(region({ notes: 'error' }).notesFailure).toBe(NOTES_UNAVAILABLE);
      expect(NOTES_UNAVAILABLE).toContain('still there');
    });

    /* The load-bearing one: a failed private channel must never read as a quiet playa. */
    it('never calls the board empty', () => {
      expect(region({ notes: 'error' }).empty).toBeNull();
    });

    it('still renders the bulletins underneath it', () => {
      const shown = region({ notes: 'error', itemCount: 3 });

      expect(shown.items).toBe(true);
      expect(shown.notesFailure).toBe(NOTES_UNAVAILABLE);
    });

    /*
     * ⚠ Silent during a search. A search shows no notes at all (`buildBoardItems`), so a
     * line about the notes channel would be an alarm about something not on screen.
     */
    it('says nothing about notes while a search is active', () => {
      expect(region({ notes: 'error', queryActive: true }).notesFailure).toBeNull();
    });
  });

  describe('when everything answered', () => {
    it('says the board is empty only once every read has landed', () => {
      expect(region().empty).toBe('Nothing on your board yet. Quiet playa.');
    });

    it('says nothing matched when a search came back with nothing', () => {
      expect(region({ queryActive: true }).empty).toBe('Nothing matches. Quiet playa.');
    });

    /* Notes never participate in a search, so a search never waits on them. */
    it('answers a search without waiting for the notes read', () => {
      expect(region({ queryActive: true, notes: 'pending' }).empty).toBe(
        'Nothing matches. Quiet playa.',
      );
    });

    it('renders the rows and claims no emptiness when there are notes to show', () => {
      expect(region({ itemCount: 1 })).toEqual({
        boardError: false,
        items: true,
        notesFailure: null,
        empty: null,
      });
    });
  });

  /*
   * A refused query is the one failure worth interrupting for: its message names the token
   * the server could not apply. Nothing renders beside it — there is no answer to show.
   */
  it('shows a refused query on its own', () => {
    expect(region({ queryActive: true, board: 'error', itemCount: 4 })).toEqual({
      boardError: true,
      items: false,
      notesFailure: null,
      empty: null,
    });
  });

  /* A failed board read with no query falls back to the cache, not to a banner. */
  it('does not interrupt an unqueried board that failed', () => {
    expect(region({ board: 'error', itemCount: 2 }).boardError).toBe(false);
  });
});

describe('channelState', () => {
  it('reads a failed query as an error, even while it is retrying', () => {
    expect(channelState({ isPending: true, isError: true })).toBe('error');
  });

  it('reads a query with no answer yet as pending', () => {
    expect(channelState({ isPending: true, isError: false })).toBe('pending');
  });

  it('reads an answered query as settled', () => {
    expect(channelState({ isPending: false, isError: false })).toBe('settled');
  });
});

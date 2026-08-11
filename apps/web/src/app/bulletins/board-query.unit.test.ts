import { describe, expect, it } from 'vitest';

import {
  BOARD_FILTER_CHIPS,
  buildBoardQuery,
  isBoardQueryActive,
  matchCountLabel,
  parseBoardQueryState,
  toggleBoardType,
  type BoardTypeFilter,
} from './board-query';

describe('buildBoardQuery', () => {
  describe('given no filter and no search text', () => {
    it('answers undefined, which is the unfiltered board rather than an empty query', () => {
      expect(buildBoardQuery([], '')).toBeUndefined();
    });

    it('treats whitespace-only search text as no search at all', () => {
      expect(buildBoardQuery([], '   ')).toBeUndefined();
    });
  });

  describe('given one type chip', () => {
    // The chip row is sugar over the grammar's `type:` term, not a second filter
    // mechanism — exactly as the comp composes it.
    it('emits the grammar term the server already accepts', () => {
      expect(buildBoardQuery(['request'], '')).toBe('type:request');
    });

    it('puts the chip term ahead of the typed words', () => {
      expect(buildBoardQuery(['request'], 'welding')).toBe('type:request welding');
    });
  });

  describe('given more than one type chip', () => {
    it('OR-alternates the selected values in one type: term', () => {
      expect(buildBoardQuery(['offer', 'request'], '')).toBe('type:offer|request');
    });

    it('orders the values by BULLETIN_TYPE declaration order, regardless of selection order', () => {
      expect(buildBoardQuery(['request', 'offer'], '')).toBe('type:offer|request');
    });

    it('deduplicates a type selected more than once', () => {
      expect(buildBoardQuery(['offer', 'offer'], '')).toBe('type:offer');
    });

    it('carries three or more values the same way', () => {
      expect(buildBoardQuery(['intro', 'offer', 'thanks'], 'x')).toBe('type:offer|thanks|intro x');
    });
  });

  describe('given search text', () => {
    it('passes bare words through untouched', () => {
      expect(buildBoardQuery([], 'welding hands')).toBe('welding hands');
    });

    it('collapses stray whitespace, which the server would otherwise count as terms', () => {
      expect(buildBoardQuery(['request'], '  welding   hands ')).toBe(
        'type:request welding hands',
      );
    });

    // Everything the grammar refuses — `from:`, `trust:`, `-word`, `"phrase"` — is
    // forwarded verbatim so the server refuses it and says which token it refused.
    // Rewriting or dropping a term here would show results nobody asked for.
    it('forwards a term this milestone does not implement rather than rewriting it', () => {
      expect(buildBoardQuery([], 'trust:>=60')).toBe('trust:>=60');
      expect(buildBoardQuery([], '-hammock')).toBe('-hammock');
    });
  });
});

describe('parseBoardQueryState', () => {
  it('answers no restriction and passes the text through untouched for a query with no type term', () => {
    expect(parseBoardQueryState('')).toEqual({ filter: [], search: '' });
    expect(parseBoardQueryState('welding hands')).toEqual({ filter: [], search: 'welding hands' });
  });

  it('recovers the chip a single type term selects, and drops that term from the search text', () => {
    expect(parseBoardQueryState('type:request')).toEqual({ filter: ['request'], search: '' });
  });

  it('finds the type term wherever it sits among other words, and leaves the rest as search text', () => {
    expect(parseBoardQueryState('welding type:request hands')).toEqual({
      filter: ['request'],
      search: 'welding hands',
    });
  });

  it('drops only the type term when other words follow it, leaving them as search text', () => {
    expect(parseBoardQueryState('type:request welding')).toEqual({ filter: ['request'], search: 'welding' });
  });

  // `update` is a real value in the server's seven-type grammar, but no chip offers it
  // (BOARD_FILTER_CHIPS) — a query naming it has nothing in the chip row to select, so it
  // stays in the search text rather than being silently dropped.
  it('answers no restriction for a grammar type with no chip, keeping the term as search text', () => {
    expect(parseBoardQueryState('type:update')).toEqual({ filter: [], search: 'type:update' });
    expect(parseBoardQueryState('type:update welding')).toEqual({
      filter: [],
      search: 'type:update welding',
    });
  });

  it('answers no restriction for a value the grammar itself would refuse, keeping the term as search text', () => {
    expect(parseBoardQueryState('type:bogus')).toEqual({ filter: [], search: 'type:bogus' });
  });

  it("answers no restriction when only some of an OR-ed term's values are chip-backed, keeping the term as search text", () => {
    expect(parseBoardQueryState('type:offer|bogus')).toEqual({ filter: [], search: 'type:offer|bogus' });
  });

  // Both forms reach the same AST server-side — the field repeated concatenates, `|`
  // alternates, and `parseBoardQuery` treats them identically (ADR-0007's grammar has no
  // repetition- or order-sensitive production over terms) — so both populate the same
  // chips rather than one populating and the other degrading.
  it('populates every value of an OR-ed multi-type term as chips, reordered to canonical order', () => {
    expect(parseBoardQueryState('type:offer|request')).toEqual({ filter: ['offer', 'request'], search: '' });
    expect(parseBoardQueryState('type:request|offer x')).toEqual({
      filter: ['offer', 'request'],
      search: 'x',
    });
  });

  it('populates the same chips for the type field repeated as for one OR-ed term', () => {
    expect(parseBoardQueryState('type:offer type:request')).toEqual({
      filter: ['offer', 'request'],
      search: '',
    });
  });

  it('deduplicates a value repeated within one OR-ed term', () => {
    expect(parseBoardQueryState('type:offer|offer')).toEqual({ filter: ['offer'], search: '' });
  });

  it('does not crash on a malformed type term, and keeps it as search text', () => {
    expect(parseBoardQueryState('type:')).toEqual({ filter: [], search: 'type:' });
    expect(parseBoardQueryState('type:offer|')).toEqual({ filter: [], search: 'type:offer|' });
  });
});

describe('parseBoardQueryState round-trips through buildBoardQuery', () => {
  // Each of these is already in the client's own canonical order — the `type:` term
  // first and its values in BULLETIN_TYPE declaration order — so rebuilding the query
  // from the parsed state reproduces the original byte for byte, not merely an
  // equivalent string. This is the property the #173 follow-up review asked for: the
  // composed request the server receives must be exactly what a person's saved text
  // already was, with the `type:` term appearing once, never twice.
  it.each<readonly [string, BoardTypeFilter, string]>([
    ['', [], ''],
    ['welding hands', [], 'welding hands'],
    ['type:request', ['request'], ''],
    ['type:request welding', ['request'], 'welding'],
    ['type:update welding', [], 'type:update welding'],
    ['type:offer|bogus x', [], 'type:offer|bogus x'],
    ['type:offer|request x', ['offer', 'request'], 'x'],
    ['type:offer|thanks|intro', ['offer', 'thanks', 'intro'], ''],
  ])('rebuilds %j byte-for-byte from {filter: %j, search: %j}', (original, filter, search) => {
    const state = parseBoardQueryState(original);
    expect(state).toEqual({ filter, search });
    expect(buildBoardQuery(state.filter, state.search)).toBe(original === '' ? undefined : original);
  });

  // These are not byte-identical: the `type:` term moves to the front, its values
  // reorder to canonical order, and duplicates within it collapse to one. Each is still
  // the same query to the server — ADR-0007's grammar is `term (WS term)*` with `values
  // := value ('|' value)*`, an implicit AND and OR with no other order- or
  // repetition-sensitive production — so re-parsing the rebuilt query recovers the same
  // state rather than a different one. "Lossless in meaning", per the module's own
  // header comment, is this property, not byte-identity.
  it.each<readonly [string, BoardTypeFilter, string, string]>([
    ['welding type:request hands', ['request'], 'welding hands', 'type:request welding hands'],
    ['type:request|offer', ['offer', 'request'], '', 'type:offer|request'],
    ['type:offer|offer', ['offer'], '', 'type:offer'],
    ['type:offer type:request', ['offer', 'request'], '', 'type:offer|request'],
  ])(
    'normalises %j to {filter: %j, search: %j}, rebuilding as %j',
    (original, filter, search, rebuiltExpected) => {
      const state = parseBoardQueryState(original);
      expect(state).toEqual({ filter, search });

      const rebuilt = buildBoardQuery(state.filter, state.search);
      expect(rebuilt).toBe(rebuiltExpected);
      expect(parseBoardQueryState(rebuilt ?? '')).toEqual(state);
    },
  );
});

describe('toggleBoardType', () => {
  it('selects a type that was not yet chosen', () => {
    expect(toggleBoardType([], 'request')).toEqual(['request']);
  });

  it('adds a second type alongside the first, independent of chip order', () => {
    expect(toggleBoardType(['request'], 'offer')).toEqual(['request', 'offer']);
  });

  it('deselects a type that was already chosen, leaving the others', () => {
    expect(toggleBoardType(['request', 'offer'], 'request')).toEqual(['offer']);
  });

  it('clears every selection when All is clicked', () => {
    expect(toggleBoardType(['request', 'offer'], 'all')).toEqual([]);
  });

  it('is a no-op clicking All again with nothing selected', () => {
    expect(toggleBoardType([], 'all')).toEqual([]);
  });
});

describe('isBoardQueryActive', () => {
  it('is false for the default board', () => {
    expect(isBoardQueryActive([], '')).toBe(false);
  });

  it('is true once a chip is chosen', () => {
    expect(isBoardQueryActive(['request'], '')).toBe(true);
  });

  it('is true once more than one chip is chosen', () => {
    expect(isBoardQueryActive(['request', 'offer'], '')).toBe(true);
  });

  it('is true once words are typed', () => {
    expect(isBoardQueryActive([], 'welding')).toBe(true);
  });
});

describe('BOARD_FILTER_CHIPS', () => {
  it('opens with the All chip', () => {
    expect(BOARD_FILTER_CHIPS[0]).toEqual({ filter: 'all', label: 'All' });
  });

  // The comp draws eight chips. Only the six postable types get one (#87): a chip for
  // `update` would filter to a permanently empty board, and `note` is never a value.
  // Spelled out literally, in the comp's order — the chip row is *built* from
  // `Object.values(BULLETIN_TYPE)`, so comparing against that expression would restate
  // the implementation and green-light any vocabulary forever.
  it('carries one chip per postable bulletin type, in comp order, and no others', () => {
    expect(BOARD_FILTER_CHIPS.slice(1).map((chip) => chip.filter)).toEqual([
      'offer',
      'request',
      'event',
      'collab',
      'thanks',
      'intro',
    ]);
  });

  it("labels each type chip in the comp's plural form", () => {
    expect(BOARD_FILTER_CHIPS.slice(1).map((chip) => chip.label)).toEqual([
      'Offers',
      'Requests',
      'Events',
      'Collabs',
      'Thanks',
      'Intros',
    ]);
  });
});

describe('matchCountLabel', () => {
  it('says "match" for exactly one', () => {
    expect(matchCountLabel(1)).toBe('1 match');
  });

  it('says "matches" for none and for many', () => {
    expect(matchCountLabel(0)).toBe('0 matches');
    expect(matchCountLabel(4)).toBe('4 matches');
  });
});

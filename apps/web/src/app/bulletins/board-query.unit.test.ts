import { describe, expect, it } from 'vitest';

import {
  BOARD_FILTER_CHIPS,
  buildBoardQuery,
  isBoardQueryActive,
  matchCountLabel,
  parseBoardQueryState,
  type BoardTypeFilter,
} from './board-query';

describe('buildBoardQuery', () => {
  describe('given no filter and no search text', () => {
    it('answers undefined, which is the unfiltered board rather than an empty query', () => {
      expect(buildBoardQuery('all', '')).toBeUndefined();
    });

    it('treats whitespace-only search text as no search at all', () => {
      expect(buildBoardQuery('all', '   ')).toBeUndefined();
    });
  });

  describe('given a type chip', () => {
    // The chip row is sugar over the grammar's `type:` term, not a second filter
    // mechanism — exactly as the comp composes it.
    it('emits the grammar term the server already accepts', () => {
      expect(buildBoardQuery('request', '')).toBe('type:request');
    });

    it('puts the chip term ahead of the typed words', () => {
      expect(buildBoardQuery('request', 'welding')).toBe('type:request welding');
    });
  });

  describe('given search text', () => {
    it('passes bare words through untouched', () => {
      expect(buildBoardQuery('all', 'welding hands')).toBe('welding hands');
    });

    it('collapses stray whitespace, which the server would otherwise count as terms', () => {
      expect(buildBoardQuery('request', '  welding   hands ')).toBe(
        'type:request welding hands',
      );
    });

    // Everything the grammar refuses — `from:`, `trust:`, `-word`, `"phrase"` — is
    // forwarded verbatim so the server refuses it and says which token it refused.
    // Rewriting or dropping a term here would show results nobody asked for.
    it('forwards a term this milestone does not implement rather than rewriting it', () => {
      expect(buildBoardQuery('all', 'trust:>=60')).toBe('trust:>=60');
      expect(buildBoardQuery('all', '-hammock')).toBe('-hammock');
    });
  });
});

describe('parseBoardQueryState', () => {
  it('answers "all" and passes the text through untouched for a query with no type term', () => {
    expect(parseBoardQueryState('')).toEqual({ filter: 'all', search: '' });
    expect(parseBoardQueryState('welding hands')).toEqual({ filter: 'all', search: 'welding hands' });
  });

  it('recovers the chip a single type term selects, and drops that term from the search text', () => {
    expect(parseBoardQueryState('type:request')).toEqual({ filter: 'request', search: '' });
  });

  it('finds the type term wherever it sits among other words, and leaves the rest as search text', () => {
    expect(parseBoardQueryState('welding type:request hands')).toEqual({
      filter: 'request',
      search: 'welding hands',
    });
  });

  it('drops only the type term when other words follow it, leaving them as search text', () => {
    expect(parseBoardQueryState('type:request welding')).toEqual({ filter: 'request', search: 'welding' });
  });

  // `update` is a real value in the server's seven-type grammar, but no chip offers it
  // (BOARD_FILTER_CHIPS) — a query naming it has nothing in the chip row to select, so it
  // stays in the search text rather than being silently dropped from what was typed.
  it('answers "all" for a grammar type with no chip, keeping the term as search text', () => {
    expect(parseBoardQueryState('type:update')).toEqual({ filter: 'all', search: 'type:update' });
    expect(parseBoardQueryState('type:update welding')).toEqual({
      filter: 'all',
      search: 'type:update welding',
    });
  });

  it('answers "all" for a value the grammar itself would refuse, keeping the term as search text', () => {
    expect(parseBoardQueryState('type:bogus')).toEqual({ filter: 'all', search: 'type:bogus' });
  });

  // This milestone's client can only ever write one type into a query, but the server
  // grammar already accepts several — pipe alternation within one term, or the field
  // repeated — and #171 is what will teach the chip row to select more than one. Until
  // then this degrades to "all" rather than guessing which of several values a
  // single-select chip row should show, and never drops what was actually typed.
  it('answers "all" for an OR-ed multi-type term, keeping the term as search text', () => {
    expect(parseBoardQueryState('type:offer|request')).toEqual({
      filter: 'all',
      search: 'type:offer|request',
    });
    expect(parseBoardQueryState('type:offer|request x')).toEqual({
      filter: 'all',
      search: 'type:offer|request x',
    });
  });

  it('answers "all" for the type field repeated, keeping both terms as search text', () => {
    expect(parseBoardQueryState('type:offer type:request')).toEqual({
      filter: 'all',
      search: 'type:offer type:request',
    });
  });

  it('does not crash on a malformed type term, and keeps it as search text', () => {
    expect(parseBoardQueryState('type:')).toEqual({ filter: 'all', search: 'type:' });
    expect(parseBoardQueryState('type:offer|')).toEqual({ filter: 'all', search: 'type:offer|' });
  });
});

describe('parseBoardQueryState round-trips through buildBoardQuery', () => {
  // Each of these is already in the client's own canonical order — the `type:` term
  // first, exactly what `buildBoardQuery` itself emits — so rebuilding the query from
  // the parsed state reproduces the original byte for byte, not merely an equivalent
  // string. This is the property the #173 follow-up review asked for: the composed
  // request the server receives must be exactly what a person's saved text already was,
  // with the `type:` term appearing once, never twice.
  it.each<readonly [string, BoardTypeFilter, string]>([
    ['', 'all', ''],
    ['welding hands', 'all', 'welding hands'],
    ['type:request', 'request', ''],
    ['type:request welding', 'request', 'welding'],
    ['type:update welding', 'all', 'type:update welding'],
    ['type:offer|request x', 'all', 'type:offer|request x'],
  ])('rebuilds %j byte-for-byte from {filter: %j, search: %j}', (original, filter, search) => {
    const state = parseBoardQueryState(original);
    expect(state).toEqual({ filter, search });
    expect(buildBoardQuery(state.filter, state.search)).toBe(original === '' ? undefined : original);
  });

  // When the `type:` term sits somewhere other than first in the original text, the
  // rebuilt string moves it to the front — `buildBoardQuery` always composes the chip
  // term first — so this pair is not byte-identical. It is still the same query to the
  // server: ADR-0007's grammar is `term (WS term)*`, an implicit AND with no other
  // order-sensitive production, so re-parsing the rebuilt query recovers the same state
  // rather than a different one.
  it('re-parses to the same state even when the type: term was not first in the original', () => {
    const original = 'welding type:request hands';
    const state = parseBoardQueryState(original);
    expect(state).toEqual({ filter: 'request', search: 'welding hands' });

    const rebuilt = buildBoardQuery(state.filter, state.search);
    expect(rebuilt).toBe('type:request welding hands');
    expect(parseBoardQueryState(rebuilt ?? '')).toEqual(state);
  });
});

describe('isBoardQueryActive', () => {
  it('is false for the default board', () => {
    expect(isBoardQueryActive('all', '')).toBe(false);
  });

  it('is true once a chip is chosen', () => {
    expect(isBoardQueryActive('request', '')).toBe(true);
  });

  it('is true once words are typed', () => {
    expect(isBoardQueryActive('all', 'welding')).toBe(true);
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

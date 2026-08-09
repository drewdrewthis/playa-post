import { describe, expect, it } from 'vitest';

import {
  BOARD_FILTER_CHIPS,
  buildBoardQuery,
  isBoardQueryActive,
  matchCountLabel,
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

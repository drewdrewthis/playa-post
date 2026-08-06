import { describe, expect, it } from 'vitest';

// None of these exist yet — legible failure at this seam until the coder writes them.
import { InvalidBoardQueryError, parseBoardQuery } from '../../domain/board-query-grammar';

/**
 * `specs/features/board-visibility-query.feature`'s four `@unit` scenarios —
 * ADR-0007's grammar, restricted to `type:` and bare text for M2 (`from:`, `tag:`,
 * `loc:`, `deg:`, `trust:`, `is:` are M5). Pure parser tests: no database, no Kysely,
 * no compiled SQL — that half (M2-AC15's composition assertion, and the SQL shape
 * itself) is out of this lane's scope; `board-query-narrowing.security.test.ts`
 * covers the one place this lane does need the compiler, against a real authorized
 * set.
 *
 * ADR-0007's rejection rule (:53-56): "Unknown fields, unknown enum values,
 * malformed syntax, over-length input, or more than 16 terms → rejected with a
 * structured validation error naming the offending token, never silently ignored."
 */
describe('parseBoardQuery — ADR-0007 grammar restricted to type: and bare text', () => {
  describe('Scenario: Query grammar rejects type:note', () => {
    it('rejects with a structured error naming the token', () => {
      expect(() => parseBoardQuery('type:note')).toThrow(InvalidBoardQueryError);
      try {
        parseBoardQuery('type:note');
        expect.fail('parseBoardQuery("type:note") was expected to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidBoardQueryError);
        // D2 — "note" is not one of the seven PDF types and is never implemented.
        expect((error as InvalidBoardQueryError).message).toContain('note');
      }
    });
  });

  describe('Scenario: Query grammar rejects an unknown field instead of ignoring it', () => {
    it('rejects with a structured error naming the field', () => {
      try {
        parseBoardQuery('foo:bar');
        expect.fail('parseBoardQuery("foo:bar") was expected to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidBoardQueryError);
        expect((error as InvalidBoardQueryError).message).toContain('foo');
      }
    });
  });

  describe('Scenario: Query grammar enforces the 256-character length boundary', () => {
    it('accepts a query string of exactly 256 characters', () => {
      const query = 'a'.repeat(256);
      expect(query).toHaveLength(256);
      expect(() => parseBoardQuery(query)).not.toThrow();
    });

    it('rejects a query string of exactly 257 characters', () => {
      const query = 'a'.repeat(257);
      expect(query).toHaveLength(257);
      expect(() => parseBoardQuery(query)).toThrow(InvalidBoardQueryError);
    });
  });

  describe('Scenario: Query grammar enforces the 16-term boundary', () => {
    it('accepts a query with exactly 16 terms', () => {
      const query = Array.from({ length: 16 }, (_, index) => `term${String(index)}`).join(' ');
      expect(() => parseBoardQuery(query)).not.toThrow();
    });

    it('rejects a query with exactly 17 terms', () => {
      const query = Array.from({ length: 17 }, (_, index) => `term${String(index)}`).join(' ');
      expect(() => parseBoardQuery(query)).toThrow(InvalidBoardQueryError);
    });
  });
});

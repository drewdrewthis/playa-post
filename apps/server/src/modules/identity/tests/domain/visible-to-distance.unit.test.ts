import { describe, expect, it } from 'vitest';

import {
  toVisibleToDistance,
  VISIBLE_TO_DISTANCE,
} from '../../domain/visible-to-distance';

/**
 * `toVisibleToDistance` is the application layer's half of the fail-closed pact the SQL
 * makes in `app.visible_people` (`else 1` in the `reachable` CTE): an unrecognised
 * stored value must read as `first`, never as the ceiling. The database's check
 * constraint makes the unknown-value branch unreachable from any integration test — a
 * future migration widening that constraint is exactly the scenario the branch guards —
 * so this branch is only testable here, as pure logic (review thread on PR #78).
 */
describe('toVisibleToDistance', () => {
  describe('given a stored value the scale knows', () => {
    it.each(Object.values(VISIBLE_TO_DISTANCE))('returns %j unchanged', (value) => {
      expect(toVisibleToDistance(value)).toBe(value);
    });
  });

  describe('given a stored value the scale has never heard of', () => {
    it.each(['anyone', 'fourth', '', 'FIRST', ' first'])(
      'fails closed to first for %j',
      (value) => {
        expect(toVisibleToDistance(value)).toBe('first');
      },
    );
  });

  describe('given a stored value that names an Object.prototype member', () => {
    // The `Object.hasOwn` guard: with `in`, 'constructor' matches the prototype chain
    // and the lookup returns the inherited `Object` constructor — a non-literal value
    // escaping the narrowing, which a nullish fallback would not catch.
    it.each(['constructor', 'toString', 'hasOwnProperty', '__proto__'])(
      'fails closed to first for %j',
      (value) => {
        expect(toVisibleToDistance(value)).toBe('first');
      },
    );
  });
});

import { describe, expect, it } from 'vitest';

import { PERMISSIVE_LIMITS } from '../../domain/privacy-limits';
import { validatePrivacyLimits } from '../../domain/privacy-limits.policy';
import { PrivacyLimitOutOfRangeError } from '../../domain/privacy.errors';

/**
 * The two standing limits behind the You screen's "who sees your name" and "who can pin
 * to your board" (design/Playa Post.dc.html, issue #49).
 *
 * The screen offers exactly three choices per row — `ANYONE | TRUST 50+ | TRUST 75+` and
 * `UP TO 3RD° | UP TO 2ND° | 1ST° ONLY` — but the *stored* vocabulary is deliberately
 * wider than the picker: a trust threshold is any 0-100 integer and a degree is 1-3. A
 * policy that only accepted the three labels would make the next design iteration a
 * migration, and would put the UI's option list inside the domain where a second client
 * could disagree with it.
 */
describe('privacy limits (You screen, issue #49)', () => {
  describe('the permissive default', () => {
    /**
     * ⚠ This is the assertion that keeps the migration a no-op on existing data. No user
     * has a `app.privacy_settings` row until they tighten something, and
     * `app.visible_people` spells this same default out in SQL. If the two ever
     * disagreed, the observable privacy of a user who never opened the screen would
     * depend on whether a row happened to exist.
     */
    it('asks nothing of anybody — no trust floor, and the widest degree the picker offers', () => {
      expect(PERMISSIVE_LIMITS).toEqual({
        name: { minTrust: null, maxDegree: 3 },
        note: { minTrust: null, maxDegree: 3 },
      });
    });
  });

  describe('validatePrivacyLimits', () => {
    it('accepts the design’s three trust choices, with ANYONE as null rather than 0', () => {
      for (const minTrust of [null, 50, 75]) {
        expect(
          validatePrivacyLimits({
            name: { minTrust, maxDegree: 2 },
            note: { minTrust, maxDegree: 2 },
          }).name.minTrust,
        ).toBe(minTrust);
      }
    });

    /**
     * `null` and `0` are different rules and only one of them is on the screen. `null`
     * is "no trust requirement"; `0` is "I require a trust score, and it may be zero",
     * which withholds the name from everyone the owner has never rated — because unset
     * trust is NULL, not 0 (ADR-0004:70-71), and `null >= 0` is null.
     */
    it('keeps 0 distinct from null instead of collapsing the falsy pair', () => {
      const limits = validatePrivacyLimits({
        name: { minTrust: 0, maxDegree: 3 },
        note: { minTrust: null, maxDegree: 3 },
      });

      expect(limits.name.minTrust).toBe(0);
      expect(limits.note.minTrust).toBeNull();
    });

    it('accepts every degree the picker offers', () => {
      for (const maxDegree of [1, 2, 3]) {
        expect(
          validatePrivacyLimits({
            name: { minTrust: null, maxDegree },
            note: { minTrust: null, maxDegree },
          }).name.maxDegree,
        ).toBe(maxDegree);
      }
    });

    it.each([
      ['a trust floor above the scale', { minTrust: 101, maxDegree: 3 }],
      ['a negative trust floor', { minTrust: -1, maxDegree: 3 }],
      // Integers only, for the reason validateTrust gives: a fractional threshold is a
      // slider reporting its pixel position, and `smallint` would round it silently.
      ['a fractional trust floor', { minTrust: 50.5, maxDegree: 3 }],
      ['degree zero, which would hide the viewer from themselves', { minTrust: null, maxDegree: 0 }],
      ['a degree past the traversal bound', { minTrust: null, maxDegree: 4 }],
      ['a fractional degree', { minTrust: null, maxDegree: 1.5 }],
    ])('refuses %s', (_case, name) => {
      expect(() => validatePrivacyLimits({ name, note: { minTrust: null, maxDegree: 3 } })).toThrow(
        PrivacyLimitOutOfRangeError,
      );
    });

    /**
     * Both halves go through the same rule. A validator that checked only `name` would
     * pass every test above while letting an out-of-range `note` reach a check
     * constraint, where it surfaces as a driver-level 500 rather than the stable code
     * M2-AC18 asks for.
     */
    it('applies the same rule to the note limit, not only the name limit', () => {
      expect(() =>
        validatePrivacyLimits({
          name: { minTrust: null, maxDegree: 3 },
          note: { minTrust: 101, maxDegree: 3 },
        }),
      ).toThrow(PrivacyLimitOutOfRangeError);
    });

    it('carries a stable machine-readable code, never a bare Error', () => {
      expect(() =>
        validatePrivacyLimits({
          name: { minTrust: 101, maxDegree: 3 },
          note: { minTrust: null, maxDegree: 3 },
        }),
      ).toThrow(expect.objectContaining({ code: 'PRIVACY_LIMIT_OUT_OF_RANGE' }));
    });
  });
});

import { describe, expect, it } from 'vitest';

import {
  DEGREE_CHOICES,
  TRUST_CHOICES,
  degreeLabel,
  nextDegree,
  nextTrustFloor,
  trustFloorLabel,
} from './privacy-limits-view';

/**
 * The two privacy rows' pickers (design/Playa Post.dc.html, the You screen).
 *
 * The comp's picker is a *cycling pill*, not a select: tapping the value advances it and
 * wraps. Its option lists are `trustOpts = ['ANYONE','TRUST 50+','TRUST 75+']` and
 * `distOpts = ['UP TO 3RD°','UP TO 2ND°','1ST° ONLY']`, and the cycle runs loosest to
 * tightest and back — which is what these tests pin.
 */
describe('the privacy pickers', () => {
  describe('labels', () => {
    it("renders the comp's three trust labels", () => {
      expect(TRUST_CHOICES.map((choice) => trustFloorLabel(choice))).toEqual([
        'ANYONE',
        'TRUST 50+',
        'TRUST 75+',
      ]);
    });

    it("renders the comp's three degree labels", () => {
      expect(DEGREE_CHOICES.map((choice) => degreeLabel(choice))).toEqual([
        'UP TO 3RD°',
        'UP TO 2ND°',
        '1ST° ONLY',
      ]);
    });

    /**
     * The API's vocabulary is any 0-100 integer, so a value the picker cannot produce is
     * still a value the screen may be handed — by another client, or by a later design.
     * It has to read as what it is rather than fall back to a label that misstates the
     * user's own rule.
     */
    it('states a floor the picker cannot produce rather than mislabelling it', () => {
      expect(trustFloorLabel(60)).toBe('TRUST 60+');
      expect(trustFloorLabel(0)).toBe('TRUST 0+');
    });

    /** `null` is ANYONE; `0` is a floor somebody chose. Never the same label. */
    it('never renders a floor of 0 as ANYONE', () => {
      expect(trustFloorLabel(0)).not.toBe(trustFloorLabel(null));
    });
  });

  describe('cycling the trust floor', () => {
    it('runs loosest to tightest and wraps', () => {
      expect(nextTrustFloor(null)).toBe(50);
      expect(nextTrustFloor(50)).toBe(75);
      expect(nextTrustFloor(75)).toBeNull();
    });

    /**
     * ⚠ The rule is "the next floor strictly tighter than this one, else wrap to ANYONE",
     * which handles a value off the list without a special case — and, importantly,
     * without ever loosening a user's setting by more than the wrap they can see coming.
     */
    it('advances to the next tighter option from a value the picker cannot produce', () => {
      expect(nextTrustFloor(60)).toBe(75);
      expect(nextTrustFloor(10)).toBe(50);
    });

    it('wraps to ANYONE from a floor tighter than every option', () => {
      expect(nextTrustFloor(80)).toBeNull();
    });

    it('returns to where it started after one full cycle', () => {
      expect(nextTrustFloor(nextTrustFloor(nextTrustFloor(null)))).toBeNull();
    });
  });

  describe('cycling the degree limit', () => {
    it('runs loosest to tightest and wraps', () => {
      expect(nextDegree(3)).toBe(2);
      expect(nextDegree(2)).toBe(1);
      expect(nextDegree(1)).toBe(3);
    });

    it('returns to where it started after one full cycle', () => {
      expect(nextDegree(nextDegree(nextDegree(3)))).toBe(3);
    });
  });
});

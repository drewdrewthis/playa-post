import { describe, expect, it } from 'vitest';

import {
  CONNECTION_REQUEST_RATE_LIMIT,
  CONNECTION_REQUEST_RATE_WINDOW_MINUTES,
  CONNECTION_REQUEST_TTL_DAYS,
  hasLapsed,
  liveRequestFloor,
  PENDING_CONNECTION_REQUEST_CAP,
  rateWindowFloor,
} from '../../domain/connection-request.policy';

/**
 * The three limits that replace a use count (issue #206, ADR-0018 D5).
 *
 * Every one of them is arithmetic on a supplied clock rather than a stored state, so this
 * is where the arithmetic is pinned: the SQL binds these same values, so a boundary this
 * file gets wrong is a boundary the database gets wrong identically and silently.
 */
const NOW = new Date('2026-08-13T12:00:00.000Z');
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

describe('connection-request limits (issue #206)', () => {
  describe('the constants themselves', () => {
    /*
     * Pinned, not because the numbers are sacred but because they are the *product*
     * decision ADR-0018 records — "abuse handled by limits, not use counts" is only a real
     * statement if the limits exist and are the ones that were agreed. A silent edit to any
     * of them changes what the feature promises.
     */
    it('are the fourteen-day expiry, the pending cap, and the per-link rate window', () => {
      expect(CONNECTION_REQUEST_TTL_DAYS).toBe(14);
      expect(PENDING_CONNECTION_REQUEST_CAP).toBe(32);
      expect(CONNECTION_REQUEST_RATE_LIMIT).toBe(12);
      expect(CONNECTION_REQUEST_RATE_WINDOW_MINUTES).toBe(60);
    });
  });

  describe('liveRequestFloor', () => {
    it('sits exactly the TTL behind the supplied moment', () => {
      expect(liveRequestFloor(NOW).getTime()).toBe(NOW.getTime() - CONNECTION_REQUEST_TTL_DAYS * DAY);
    });

    it('reads the clock it is given and never a real one', () => {
      // Two different moments must produce two different floors, or the function is
      // ignoring its argument — the failure that would make every integration test's
      // pinned clock decorative.
      const later = new Date(NOW.getTime() + DAY);

      expect(liveRequestFloor(later).getTime() - liveRequestFloor(NOW).getTime()).toBe(DAY);
    });
  });

  describe('rateWindowFloor', () => {
    it('sits exactly the window behind the supplied moment', () => {
      expect(rateWindowFloor(NOW).getTime()).toBe(
        NOW.getTime() - CONNECTION_REQUEST_RATE_WINDOW_MINUTES * MINUTE,
      );
    });

    it('is much nearer than the TTL floor — they are two different limits', () => {
      // A regression that made one call the other would leave both tests above green and
      // would silently turn the rate window into a fortnight.
      expect(rateWindowFloor(NOW).getTime()).toBeGreaterThan(liveRequestFloor(NOW).getTime());
    });
  });

  describe('hasLapsed', () => {
    it('is false for a request made just now', () => {
      expect(hasLapsed(NOW, NOW)).toBe(false);
    });

    it('is false one millisecond inside the window', () => {
      const justInside = new Date(liveRequestFloor(NOW).getTime() + 1);

      expect(hasLapsed(justInside, NOW)).toBe(false);
    });

    /*
     * ⚠ The boundary itself is **lapsed**, and this is the assertion that keeps it agreeing
     * with the SQL. Every statement spells the predicate `created_at > liveSince`, which
     * excludes a row created exactly at the floor; a `>=` here would make this function say
     * "still live" about a request the database refuses to decide, and the owner would be
     * shown a button the server rejects.
     */
    it('is true exactly at the floor, matching the SQL predicate created_at > floor', () => {
      expect(hasLapsed(liveRequestFloor(NOW), NOW)).toBe(true);
    });

    it('is true for anything older', () => {
      const stale = new Date(liveRequestFloor(NOW).getTime() - 1);

      expect(hasLapsed(stale, NOW)).toBe(true);
    });

    it('is false for a request made in the future — no clamping, no clever guessing', () => {
      // A clock skew between the writer and the reader is a real thing, and reporting a
      // future-dated request as lapsed would delete it from the owner's inbox with no
      // recourse. Being generous here is the safe direction.
      expect(hasLapsed(new Date(NOW.getTime() + DAY), NOW)).toBe(false);
    });
  });
});

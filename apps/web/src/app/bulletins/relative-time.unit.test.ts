import { describe, expect, it } from 'vitest';

import { relativeTime, timeUntil } from './relative-time';

const now = new Date('2026-08-08T12:00:00.000Z');

function hoursBefore(hours: number, minutes = 0): string {
  return new Date(now.getTime() - hours * 3_600_000 - minutes * 60_000).toISOString();
}

function hoursAfter(hours: number, minutes = 0): string {
  return new Date(now.getTime() + hours * 3_600_000 + minutes * 60_000).toISOString();
}

describe('relativeTime', () => {
  describe('given a moment less than a day ago', () => {
    it('reads whole hours, as the comp writes them', () => {
      expect(relativeTime(hoursBefore(2), now)).toBe('2h');
      expect(relativeTime(hoursBefore(5), now)).toBe('5h');
    });

    it('floors rather than rounds, so a card never claims to be older than it is', () => {
      expect(relativeTime(hoursBefore(2, 59), now)).toBe('2h');
    });

    it('still reads hours one minute short of a day', () => {
      expect(relativeTime(hoursBefore(23, 59), now)).toBe('23h');
    });
  });

  describe('given a moment a day or more ago', () => {
    it('switches to whole days at exactly 24 hours', () => {
      expect(relativeTime(hoursBefore(24), now)).toBe('1d');
    });

    it('reads days, as the comp writes them', () => {
      expect(relativeTime(hoursBefore(24 * 3), now)).toBe('3d');
      expect(relativeTime(hoursBefore(24 * 3, 59), now)).toBe('3d');
    });
  });

  describe('given a moment less than an hour ago', () => {
    // The comp has no sub-hour tier and no minute granularity. "0h" would read as
    // broken, so the one boundary state below the comp's smallest unit is named.
    it('reads "now" rather than "0h"', () => {
      expect(relativeTime(hoursBefore(0, 5), now)).toBe('now');
      expect(relativeTime(hoursBefore(0, 59), now)).toBe('now');
    });
  });

  describe('given a moment in the future', () => {
    // Clock skew between a device and the server, not a real event. It must not
    // render as a negative age.
    it('reads "now" rather than a negative age', () => {
      expect(relativeTime(hoursAfter(3), now)).toBe('now');
    });
  });

  describe('given a timestamp with an offset rather than Z', () => {
    it('reads the offset, not the local zone', () => {
      expect(relativeTime('2026-08-08T05:00:00-05:00', now)).toBe('2h');
    });
  });

  describe('given something that is not a timestamp', () => {
    it('answers null, so the caller renders nothing rather than "NaNh"', () => {
      expect(relativeTime('not a date', now)).toBeNull();
      expect(relativeTime('', now)).toBeNull();
    });
  });
});

describe('timeUntil', () => {
  describe('given a future moment', () => {
    it('reads the same hour and day shorthand', () => {
      expect(timeUntil(hoursAfter(2), now)).toBe('2h');
      expect(timeUntil(hoursAfter(24 * 3), now)).toBe('3d');
    });

    // "now" would say the opposite of what is true of something still to come.
    it('reads "<1h" under an hour rather than "now"', () => {
      expect(timeUntil(hoursAfter(0, 20), now)).toBe('<1h');
    });
  });

  describe('given a moment already past', () => {
    // `VisibleBulletin.expiresAt` is always in the future, so this is only ever clock
    // skew. Answering null renders no countdown rather than a wrong one.
    it('answers null', () => {
      expect(timeUntil(hoursBefore(1), now)).toBeNull();
    });
  });

  describe('given something that is not a timestamp', () => {
    it('answers null', () => {
      expect(timeUntil('not a date', now)).toBeNull();
    });
  });
});

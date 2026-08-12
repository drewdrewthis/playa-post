import { describe, expect, it } from 'vitest';

import { createSoftDeletedRowPurge, type PurgeTarget } from './purge-soft-deleted-rows';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/** A fixed reading, so every cutoff below is arithmetic a reader can check by eye. */
const NOW = new Date('2026-08-12T12:00:00.000Z');

/**
 * A target that remembers every cutoff it was handed and answers a fixed count.
 *
 * A fake rather than a mock (`references/principles/coding.md`): the assertions below are
 * about the cutoff each store was *given* and the counts that came back, which are
 * artifacts, not a call sequence.
 */
function fakeTarget(
  name: string,
  rows: number,
): PurgeTarget & { readonly cutoffs: readonly Date[] } {
  const cutoffs: Date[] = [];

  return {
    name,
    cutoffs,
    purge(deletedBefore: Date): Promise<number> {
      cutoffs.push(deletedBefore);
      return Promise.resolve(rows);
    },
  };
}

/** A target that refuses, so the round's failure behaviour is observable. */
function failingTarget(name: string, error: Error): PurgeTarget {
  return { name, purge: () => Promise.reject(error) };
}

describe('createSoftDeletedRowPurge (issue #169)', () => {
  describe('the cutoff', () => {
    it('is `now` less the configured retention window', async () => {
      const target = fakeTarget('removed bulletins', 0);
      const purge = createSoftDeletedRowPurge({ retentionDays: 30, targets: [target] });

      const result = await purge.purgeOnce({ now: NOW });

      expect(result.deletedBefore).toEqual(new Date(NOW.getTime() - 30 * MILLISECONDS_PER_DAY));
      expect(target.cutoffs).toEqual([result.deletedBefore]);
    });

    it('follows the configured window rather than a constant', async () => {
      // The whole of AC3: the window is configuration-driven. A 30 baked in anywhere
      // would pass the test above and fail this one.
      const target = fakeTarget('removed bulletins', 0);
      const purge = createSoftDeletedRowPurge({ retentionDays: 7, targets: [target] });

      const { deletedBefore } = await purge.purgeOnce({ now: NOW });

      expect(deletedBefore).toEqual(new Date(NOW.getTime() - 7 * MILLISECONDS_PER_DAY));
    });

    it('is the same instant for every target', async () => {
      // Derived once and shared. A clock read per target would let two stores disagree
      // about where the window starts, so a row deleted in the gap between them would be
      // swept from one and kept in the other — a discrepancy nothing would ever surface.
      const bulletins = fakeTarget('removed bulletins', 0);
      const views = fakeTarget('deleted saved views', 0);
      const purge = createSoftDeletedRowPurge({ retentionDays: 30, targets: [bulletins, views] });

      const { deletedBefore } = await purge.purgeOnce({ now: NOW });

      expect(bulletins.cutoffs).toEqual([deletedBefore]);
      expect(views.cutoffs).toEqual([deletedBefore]);
    });

    it('advances with the clock it is given, round to round', async () => {
      const target = fakeTarget('removed bulletins', 0);
      const purge = createSoftDeletedRowPurge({ retentionDays: 30, targets: [target] });

      await purge.purgeOnce({ now: NOW });
      await purge.purgeOnce({ now: new Date(NOW.getTime() + MILLISECONDS_PER_DAY) });

      const [first, second] = target.cutoffs;
      expect(second?.getTime()).toBe((first?.getTime() ?? 0) + MILLISECONDS_PER_DAY);
    });
  });

  describe('the round’s report', () => {
    it('names each target and what it removed, in the order they were swept', async () => {
      const purge = createSoftDeletedRowPurge({
        retentionDays: 30,
        targets: [fakeTarget('removed bulletins', 8), fakeTarget('deleted saved views', 4)],
      });

      const result = await purge.purgeOnce({ now: NOW });

      expect(result.purged).toEqual([
        { name: 'removed bulletins', rows: 8 },
        { name: 'deleted saved views', rows: 4 },
      ]);
      expect(result.totalRows).toBe(12);
    });

    it('totals zero when nothing was old enough — the steady state', async () => {
      const purge = createSoftDeletedRowPurge({
        retentionDays: 30,
        targets: [fakeTarget('removed bulletins', 0), fakeTarget('deleted saved views', 0)],
      });

      const result = await purge.purgeOnce({ now: NOW });

      expect(result.totalRows).toBe(0);
    });

    it('sweeps nothing and reports nothing when no target is wired', async () => {
      // Legal rather than an error: "this deployment has no soft-deleted store" is a
      // configuration, and the sweep answering an empty report is the truthful reading.
      const purge = createSoftDeletedRowPurge({ retentionDays: 30, targets: [] });

      expect(await purge.purgeOnce({ now: NOW })).toEqual({
        deletedBefore: new Date(NOW.getTime() - 30 * MILLISECONDS_PER_DAY),
        purged: [],
        totalRows: 0,
      });
    });
  });

  describe('given a target that refuses', () => {
    it('ends the round rather than reporting a success it did not have', async () => {
      const error = new Error('deadlock detected');
      const later = fakeTarget('deleted saved views', 4);
      const purge = createSoftDeletedRowPurge({
        retentionDays: 30,
        targets: [failingTarget('removed bulletins', error), later],
      });

      await expect(purge.purgeOnce({ now: NOW })).rejects.toBe(error);

      // The load-bearing half: the sweep is idempotent and runs again within the hour, so
      // stopping early costs one interval. Catching per target and carrying on would let
      // the poller log a successful round for a store that has not been swept in months.
      expect(later.cutoffs).toEqual([]);
    });
  });
});

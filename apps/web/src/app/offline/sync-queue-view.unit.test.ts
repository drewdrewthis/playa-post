import { describe, expect, it } from 'vitest';

import type { PendingMutationRow } from './database';
import { describeQueuedMutation, sortedQueue } from './sync-queue-view';

const row = (over: Partial<PendingMutationRow> = {}): PendingMutationRow => ({
  mutationId: 'm1',
  mutationType: 'bulletin.create',
  clientCreatedAt: '2026-08-08T10:00:00.000Z',
  payload: { title: 'Truck space Reno → BRC' },
  state: 'pending',
  attempts: 0,
  lastError: null,
  ...over,
});

/**
 * The SYNC section's rows on the You screen (design/Playa Post.dc.html).
 *
 * The comp renders `text` plus a status pill per queued item. This module is the whole of
 * that mapping, kept out of the component so it can be asserted without a DOM — the
 * convention `notifications-view.ts` and `graph-counts.ts` already follow here.
 */
describe('the sync queue, as the You screen shows it', () => {
  describe('what a row says', () => {
    it('names a queued bulletin by its title', () => {
      expect(describeQueuedMutation(row()).text).toBe('Bulletin · Truck space Reno → BRC');
    });

    /**
     * ⚠ `payload` is `unknown` — it is whatever was frozen at queue time, and the store
     * survives reloads and app versions. A row whose payload has no usable title still
     * has to render, because the one job of this list is to account for work that has not
     * landed.
     */
    it('falls back to the mutation type when the payload carries no title', () => {
      expect(describeQueuedMutation(row({ payload: {} })).text).toBe('Bulletin');
      expect(describeQueuedMutation(row({ payload: null })).text).toBe('Bulletin');
      expect(describeQueuedMutation(row({ payload: { title: '   ' } })).text).toBe('Bulletin');
    });

    it('names an archive without pretending it has a title', () => {
      expect(
        describeQueuedMutation(row({ mutationType: 'bulletin.archive', payload: { bulletinId: 'b1' } }))
          .text,
      ).toBe('Archived bulletin');
    });

    /** A type this build does not know about is still work the user is owed an account of. */
    it('renders an unrecognised mutation type rather than dropping the row', () => {
      expect(describeQueuedMutation(row({ mutationType: 'trust.set' })).text).toBe('trust.set');
    });
  });

  describe('the status pill', () => {
    it.each([
      ['pending', 'PENDING'],
      ['inflight', 'SYNCING'],
      ['failed', 'FAILED'],
      ['conflicted', 'CONFLICT'],
      ['synced', 'SYNCED'],
    ] as const)('shows %s as %s', (state, pill) => {
      expect(describeQueuedMutation(row({ state })).pill).toBe(pill);
    });

    /**
     * The comp tints the pill warn/ok. Three tones rather than two, because `failed` and
     * `conflicted` are not "still working on it" — a user who reads them as amber will
     * wait for something that is never going to happen on its own.
     */
    it.each([
      ['pending', 'waiting'],
      ['inflight', 'waiting'],
      ['failed', 'bad'],
      ['conflicted', 'bad'],
      ['synced', 'good'],
    ] as const)('tones %s as %s', (state, tone) => {
      expect(describeQueuedMutation(row({ state })).tone).toBe(tone);
    });
  });

  describe('ordering', () => {
    /**
     * Oldest first, matching the order the drainer will replay them in
     * (`claimPendingMutations`). A list that disagreed with the replay order would make a
     * dependent pair look like it was going to be applied backwards.
     */
    it('lists oldest first, the order the drainer replays', () => {
      const older = row({ mutationId: 'a', clientCreatedAt: '2026-08-08T09:00:00.000Z' });
      const newer = row({ mutationId: 'b', clientCreatedAt: '2026-08-08T11:00:00.000Z' });

      expect(sortedQueue([newer, older]).map((entry) => entry.mutationId)).toEqual(['a', 'b']);
    });

    it('does not mutate the array it was given', () => {
      const rows = [
        row({ mutationId: 'b', clientCreatedAt: '2026-08-08T11:00:00.000Z' }),
        row({ mutationId: 'a', clientCreatedAt: '2026-08-08T09:00:00.000Z' }),
      ];

      sortedQueue(rows);

      expect(rows.map((entry) => entry.mutationId)).toEqual(['b', 'a']);
    });
  });
});

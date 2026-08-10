import { describe, expect, it } from 'vitest';

import type { OfflineDatabase, PendingMutationRow, PendingMutationState } from '../offline/database';
import type { SyncRunner } from '../offline/sync-runner';

import { submitBulletin } from './submit-bulletin';

/**
 * Posting a bulletin, and what the read-back says once the drain settles.
 *
 * The store and the drainer are fakes holding real state, mirroring
 * `notes/pin-note-submit.unit.test.ts` — the queue is what this module reads its answer
 * off, so a mock recording calls would assert nothing about the row the screen ends up
 * describing.
 */

/** An in-memory `pendingMutations`, optionally broken the way IndexedDB breaks. */
function fakeStore(fault: { readonly reads?: boolean } = {}) {
  const rows = new Map<string, PendingMutationRow>();

  const database = {
    pendingMutations: {
      add(row: PendingMutationRow): Promise<string> {
        rows.set(row.mutationId, row);

        return Promise.resolve(row.mutationId);
      },
      get(mutationId: string): Promise<PendingMutationRow | undefined> {
        if (fault.reads === true) {
          return Promise.reject(new Error('InvalidStateError'));
        }

        return Promise.resolve(rows.get(mutationId));
      },
    },
  } as unknown as OfflineDatabase;

  return {
    database,
    queued: (): readonly PendingMutationRow[] => [...rows.values()],
    /** What a drain does to the queue, without the drainer. */
    settle(state: PendingMutationState, lastError: string | null = null): void {
      for (const [mutationId, row] of rows) {
        rows.set(mutationId, { ...row, state, lastError });
      }
    },
    /** What a drain that already synced and pruned this row on an earlier pass leaves behind: nothing (issue #180). */
    prune(mutationId: string): void {
      rows.delete(mutationId);
    },
  };
}

function fakeRunner(onDrain: () => void = () => undefined): SyncRunner {
  return {
    drain(): Promise<void> {
      onDrain();

      return Promise.resolve();
    },
  };
}

describe('submitBulletin', () => {
  it('reports a synced row as posted', async () => {
    const store = fakeStore();
    const runner = fakeRunner(() => {
      store.settle('synced');
    });

    const outcome = await submitBulletin({
      database: store.database,
      syncRunner: runner,
      payload: { title: 'Truck space' },
    });

    expect(outcome).toEqual({ kind: 'posted', message: 'Posted — it’s on your board.' });
  });

  it('queues against the payload it was given', async () => {
    const store = fakeStore();
    const runner = fakeRunner(() => {
      store.settle('synced');
    });

    await submitBulletin({
      database: store.database,
      syncRunner: runner,
      payload: { title: 'Truck space' },
    });

    expect(store.queued()[0]).toMatchObject({
      mutationType: 'bulletin.create',
      payload: { title: 'Truck space' },
    });
  });

  /*
   * ⚠ The bug `pruneSyncedMutations` introduced (issue #180): before it existed, a row
   * this call just wrote and just drained could only be missing if the store itself was
   * unreadable, and `pending` was the safe reading of that. Now a mutationId this call
   * minted can be missing because a drain — this one, an overlapping one, or another
   * tab's — already synced and swept it before this read landed.
   */
  it('reports a row already synced and pruned as posted, not queued', async () => {
    const store = fakeStore();
    const runner = fakeRunner(() => {
      const [row] = store.queued();

      if (row) {
        store.prune(row.mutationId);
      }
    });

    const outcome = await submitBulletin({
      database: store.database,
      syncRunner: runner,
      payload: { title: 'Truck space' },
    });

    expect(outcome).toEqual({ kind: 'posted', message: 'Posted — it’s on your board.' });
  });

  it('reports a row still pending as queued', async () => {
    const store = fakeStore();
    const runner = fakeRunner();

    const outcome = await submitBulletin({
      database: store.database,
      syncRunner: runner,
      payload: { title: 'Truck space' },
    });

    expect(outcome).toEqual({ kind: 'queued', message: 'Queued — will sync when you’re back.' });
  });

  it('reports a server refusal, keeping the screen on the form', async () => {
    const store = fakeStore();
    const runner = fakeRunner(() => {
      store.settle('failed', 'BULLETIN_EXPIRY_INVALID');
    });

    const outcome = await submitBulletin({
      database: store.database,
      syncRunner: runner,
      payload: { title: 'Truck space' },
    });

    expect(outcome.kind).toBe('refused');
  });

  /*
   * ⚠ Totality on the store, matching `pin-note-submit.ts`: a store that cannot be read
   * is not a store that lost the write, so this stays `queued` rather than throwing.
   */
  it('reports queued when the store cannot be read back at all', async () => {
    const store = fakeStore({ reads: true });
    const runner = fakeRunner();

    const outcome = await submitBulletin({
      database: store.database,
      syncRunner: runner,
      payload: { title: 'Truck space' },
    });

    expect(outcome.kind).toBe('queued');
  });
});

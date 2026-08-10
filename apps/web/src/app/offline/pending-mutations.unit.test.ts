import { describe, expect, it } from 'vitest';

import type { OfflineDatabase, PendingMutationRow, PendingMutationState } from './database';
import { pruneSyncedMutations } from './pending-mutations';

function row(over: Partial<PendingMutationRow> = {}): PendingMutationRow {
  return {
    mutationId: 'm1',
    mutationType: 'note.pin',
    clientCreatedAt: '2026-08-09T10:00:00.000Z',
    payload: {},
    state: 'pending',
    attempts: 0,
    lastError: null,
    ...over,
  };
}

/** An in-memory stand-in for the one Dexie query this function makes. */
function fakeDatabase(seed: readonly PendingMutationRow[]) {
  const rows = new Map(seed.map((entry) => [entry.mutationId, entry]));

  const pendingMutations = {
    where(index: keyof PendingMutationRow) {
      return {
        equals(value: PendingMutationState) {
          return {
            delete(): Promise<number> {
              const matches = [...rows.values()].filter((entry) => entry[index] === value);

              for (const match of matches) {
                rows.delete(match.mutationId);
              }

              return Promise.resolve(matches.length);
            },
          };
        },
      };
    },
  };

  return {
    database: { pendingMutations } as unknown as OfflineDatabase,
    remaining: (): readonly string[] => [...rows.keys()],
  };
}

/**
 * The only place `pendingMutations` loses a row (issue #174): nothing ever deleted a
 * `synced` one, so the You screen's Sync section grew forever. `sync-runner.ts` calls
 * this at the top of every drain pass — the "one pass of visibility" behavioral contract
 * lives in `sync-runner.unit.test.ts`; this file is the query in isolation.
 */
describe('pruneSyncedMutations', () => {
  it('deletes every row already synced', async () => {
    const store = fakeDatabase([
      row({ mutationId: 'synced-1', state: 'synced' }),
      row({ mutationId: 'synced-2', state: 'synced' }),
    ]);

    await pruneSyncedMutations(store.database);

    expect(store.remaining()).toEqual([]);
  });

  it.each(['pending', 'inflight', 'failed', 'conflicted'] as const)(
    'leaves a %s row untouched',
    async (state) => {
      const store = fakeDatabase([row({ mutationId: 'm1', state })]);

      await pruneSyncedMutations(store.database);

      expect(store.remaining()).toEqual(['m1']);
    },
  );

  it('prunes only the synced rows out of a mixed queue', async () => {
    const store = fakeDatabase([
      row({ mutationId: 'stale', state: 'synced' }),
      row({ mutationId: 'waiting', state: 'pending' }),
      row({ mutationId: 'broken', state: 'failed' }),
    ]);

    await pruneSyncedMutations(store.database);

    expect([...store.remaining()].sort()).toEqual(['broken', 'waiting']);
  });

  it('is a no-op on an empty queue', async () => {
    const store = fakeDatabase([]);

    await expect(pruneSyncedMutations(store.database)).resolves.toBeUndefined();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MutationEnvelope, MutationOutcome } from '@playa-post/contracts';

import type { PlayaPostClient } from '../api/client';

import type { CachedBoardRow, OfflineDatabase, PendingMutationRow } from './database';
import { createSyncRunner } from './sync-runner';

/**
 * The drainer, against a fake store and a fake server.
 *
 * Both fakes stand at boundaries this app does not own — IndexedDB through Dexie, and the
 * tRPC client — and both are *fakes* rather than mocks: they hold real state and answer
 * from it, so every assertion below is about the rows the runner left behind rather than
 * about which functions it called.
 *
 * The `unit` project runs in plain Node, where `navigator.onLine` does not exist and
 * `drainOnce` would return before claiming anything. Every test stubs it.
 */

const CLOCK = '2026-08-09T10:00:00.000Z';

function pendingRow(over: Partial<PendingMutationRow> = {}): PendingMutationRow {
  return {
    mutationId: 'm1',
    mutationType: 'note.pin',
    clientCreatedAt: CLOCK,
    payload: { recipientId: 'person-1', body: 'Come find me at the pavilion.' },
    state: 'pending',
    attempts: 0,
    lastError: null,
    ...over,
  };
}

/** An in-memory stand-in for the two Dexie tables the drainer touches. */
function fakeDatabase(seed: readonly PendingMutationRow[] = []) {
  const pending = new Map<string, PendingMutationRow>(seed.map((row) => [row.mutationId, row]));
  const board = new Map<string, CachedBoardRow>();

  const pendingMutations = {
    add(row: PendingMutationRow): Promise<string> {
      pending.set(row.mutationId, row);

      return Promise.resolve(row.mutationId);
    },
    get(mutationId: string): Promise<PendingMutationRow | undefined> {
      return Promise.resolve(pending.get(mutationId));
    },
    update(mutationId: string, changes: Partial<PendingMutationRow>): Promise<number> {
      const row = pending.get(mutationId);

      if (row === undefined) {
        return Promise.resolve(0);
      }

      pending.set(mutationId, { ...row, ...changes });

      return Promise.resolve(1);
    },
    where(index: keyof PendingMutationRow) {
      return {
        equals(value: unknown) {
          return {
            toArray(): Promise<readonly PendingMutationRow[]> {
              return Promise.resolve([...pending.values()].filter((row) => row[index] === value));
            },
          };
        },
      };
    },
  };

  const cachedBoard = {
    put(row: CachedBoardRow): Promise<string> {
      board.set(row.id, row);

      return Promise.resolve(row.id);
    },
  };

  return {
    database: { pendingMutations, cachedBoard } as unknown as OfflineDatabase,
    /** Every queued row, so a test can read the state the drainer left it in. */
    row: (mutationId: string): PendingMutationRow | undefined => pending.get(mutationId),
    cached: (): readonly CachedBoardRow[] => [...board.values()],
  };
}

/** The batch call, answered by whatever the test hands in. */
function fakeApi(
  answer: (mutations: readonly MutationEnvelope[]) => Promise<readonly MutationOutcome[]>,
) {
  const submitted: (readonly string[])[] = [];

  const client = {
    query: (): Promise<never> => Promise.reject(new Error('the drainer reads nothing')),
    mutate: (path: string, input: unknown): Promise<{ results: readonly MutationOutcome[] }> => {
      if (path !== 'sync.submitMutations') {
        return Promise.reject(new Error(`the drainer called ${path}`));
      }

      const { mutations } = input as { mutations: readonly MutationEnvelope[] };

      submitted.push(mutations.map((mutation) => mutation.mutationId));

      return answer(mutations).then((results) => ({ results }));
    },
  } as unknown as PlayaPostClient;

  return { client, submitted };
}

/** A tRPC error envelope, as `procedureErrorCode` and `applicationErrorCode` read one. */
function envelopeError(data: { code?: string; applicationCode?: string }): Error {
  return Object.assign(new Error('the call did not land'), { data });
}

function applied(mutationId: string, result?: unknown): MutationOutcome {
  return { mutationId, outcome: 'applied', result };
}

function rejected(mutationId: string, code: string): MutationOutcome {
  return { mutationId, outcome: 'rejected', error: { code, message: 'the server said no' } };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });

  return { promise, resolve };
}

describe('the sync runner', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', { onLine: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('caching what came back', () => {
    /*
     * ⚠ The `PinnedNote`-quacks-like-a-`Bulletin` hazard, both ways round. A pinned note's
     * result carries an `id` and a `createdAt`, so a cache gated on the *shape* of the
     * result would accept one and put a note on its author's own board — where it does not
     * belong twice over, since a note lands on its recipient's board and this device never
     * renders that. The gate is the mutation type, and these two tests are what hold it
     * there.
     */
    it('caches nothing when a pinned note comes back applied', async () => {
      const store = fakeDatabase([pendingRow({ mutationId: 'n1', mutationType: 'note.pin' })]);
      const api = fakeApi((mutations) =>
        Promise.resolve(
          mutations.map((mutation) =>
            applied(mutation.mutationId, {
              id: 'note-1',
              recipientId: 'person-1',
              createdAt: CLOCK,
            }),
          ),
        ),
      );

      await createSyncRunner({ database: store.database, api: api.client }).drain();

      expect(store.cached()).toEqual([]);
      expect(store.row('n1')?.state).toBe('synced');
    });

    it('caches the author’s own card when a bulletin comes back applied', async () => {
      const store = fakeDatabase([
        pendingRow({ mutationId: 'b1', mutationType: 'bulletin.create' }),
      ]);
      const api = fakeApi((mutations) =>
        Promise.resolve(
          mutations.map((mutation) =>
            applied(mutation.mutationId, {
              id: 'bulletin-1',
              title: 'Truck space Reno → BRC',
              createdAt: CLOCK,
            }),
          ),
        ),
      );

      await createSyncRunner({ database: store.database, api: api.client }).drain();

      const cached = store.cached();

      expect(cached).toHaveLength(1);
      expect(cached[0]?.id).toBe('bulletin-1');
      expect(cached[0]?.card.kind).toBe('own');
      expect(store.row('b1')?.state).toBe('synced');
    });
  });

  describe('when the whole call fails', () => {
    /*
     * ⚠ The load-bearing case. A 500, a gateway, a timeout, and a rate limit all arrive as
     * a bare envelope code, and the server never read the write. Putting the row down as
     * `failed` here is what made the compose screen say "The server refused this note"
     * about a note nobody had evaluated.
     */
    it('returns rows to the queue carrying the envelope code, rather than failing them', async () => {
      const store = fakeDatabase([pendingRow({ mutationId: 'n1' })]);
      const api = fakeApi(() =>
        Promise.reject(envelopeError({ code: 'INTERNAL_SERVER_ERROR' })),
      );

      await createSyncRunner({ database: store.database, api: api.client }).drain();

      expect(store.row('n1')).toMatchObject({
        state: 'pending',
        lastError: 'INTERNAL_SERVER_ERROR',
        attempts: 1,
      });
    });

    it.each(['TIMEOUT', 'TOO_MANY_REQUESTS'])(
      'treats %s as worth another try',
      async (code) => {
        const store = fakeDatabase([pendingRow({ mutationId: 'n1' })]);
        const api = fakeApi(() => Promise.reject(envelopeError({ code })));

        await createSyncRunner({ database: store.database, api: api.client }).drain();

        expect(store.row('n1')?.state).toBe('pending');
        expect(store.row('n1')?.lastError).toBe(code);
      },
    );

    /*
     * An `applicationCode` is a module's own verdict — the one thing on a whole-call
     * failure that says the server read this write and refused it. That, and only that, is
     * terminal.
     */
    it('fails the rows when the failure carried an application code', async () => {
      const store = fakeDatabase([pendingRow({ mutationId: 'n1' })]);
      const api = fakeApi(() =>
        Promise.reject(
          envelopeError({ code: 'BAD_REQUEST', applicationCode: 'MUTATION_PAYLOAD_INVALID' }),
        ),
      );

      await createSyncRunner({ database: store.database, api: api.client }).drain();

      expect(store.row('n1')).toMatchObject({
        state: 'failed',
        lastError: 'MUTATION_PAYLOAD_INVALID',
      });
    });

    /** No envelope at all: the connection went, and the server said nothing. */
    it('requeues as TRANSPORT_UNAVAILABLE when there is no envelope to read', async () => {
      const store = fakeDatabase([pendingRow({ mutationId: 'n1' })]);
      const api = fakeApi(() => Promise.reject(new TypeError('Failed to fetch')));

      await createSyncRunner({ database: store.database, api: api.client }).drain();

      expect(store.row('n1')).toMatchObject({
        state: 'pending',
        lastError: 'TRANSPORT_UNAVAILABLE',
        attempts: 1,
      });
    });
  });

  /*
   * The refusal channel, and the only one. A per-envelope `rejected` is the server having
   * read this write and judged it — so it is terminal where a failed call is not.
   */
  it('fails a row the server rejected on its merits, keeping the domain code', async () => {
    const store = fakeDatabase([pendingRow({ mutationId: 'n1' })]);
    const api = fakeApi((mutations) =>
      Promise.resolve(
        mutations.map((mutation) => rejected(mutation.mutationId, 'NOTE_RECIPIENT_UNREACHABLE')),
      ),
    );

    await createSyncRunner({ database: store.database, api: api.client }).drain();

    expect(store.row('n1')).toMatchObject({
      state: 'failed',
      lastError: 'NOTE_RECIPIENT_UNREACHABLE',
    });
  });

  describe('two drains at once', () => {
    /*
     * ⚠ A `drain()` called while one is in flight must not resolve against that pass: it
     * claimed its rows before this caller wrote theirs. Handing it back is what let an
     * online pin report "Queued — will sync when you’re back" — the row was still
     * `pending` because the only pass that ran had never seen it.
     */
    it('claims a row queued mid-pass in a follow-up pass', async () => {
      const store = fakeDatabase([pendingRow({ mutationId: 'first', clientCreatedAt: CLOCK })]);
      const onTheWire = deferred();
      const gate = deferred();
      let calls = 0;

      const api = fakeApi(async (mutations) => {
        calls += 1;

        if (calls === 1) {
          onTheWire.resolve();
          await gate.promise;
        }

        return mutations.map((mutation) => applied(mutation.mutationId));
      });

      const runner = createSyncRunner({ database: store.database, api: api.client });

      const firstDrain = runner.drain();

      await onTheWire.promise;

      await store.database.pendingMutations.add(
        pendingRow({ mutationId: 'second', clientCreatedAt: '2026-08-09T10:00:01.000Z' }),
      );

      const secondDrain = runner.drain();

      gate.resolve();

      await Promise.all([firstDrain, secondDrain]);

      expect(api.submitted).toEqual([['first'], ['second']]);
      expect(store.row('second')?.state).toBe('synced');
    });

    /** Never two passes at once, and never the same envelope submitted twice. */
    it('coalesces a burst of calls onto one follow-up pass', async () => {
      const store = fakeDatabase([pendingRow({ mutationId: 'first' })]);
      const onTheWire = deferred();
      const gate = deferred();
      let calls = 0;
      let inFlight = 0;
      let peakInFlight = 0;

      const api = fakeApi(async (mutations) => {
        calls += 1;
        inFlight += 1;
        peakInFlight = Math.max(peakInFlight, inFlight);

        if (calls === 1) {
          onTheWire.resolve();
          await gate.promise;
        }

        inFlight -= 1;

        return mutations.map((mutation) => applied(mutation.mutationId));
      });

      const runner = createSyncRunner({ database: store.database, api: api.client });

      const firstDrain = runner.drain();

      await onTheWire.promise;

      await store.database.pendingMutations.add(pendingRow({ mutationId: 'second' }));

      const waiters = [runner.drain(), runner.drain(), runner.drain()];

      gate.resolve();

      await Promise.all([firstDrain, ...waiters]);

      expect(api.submitted).toEqual([['first'], ['second']]);
      expect(peakInFlight).toBe(1);
    });
  });
});

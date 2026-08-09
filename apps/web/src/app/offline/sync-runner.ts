import type { Bulletin, MutationEnvelope, MutationOutcome } from '@playa-post/contracts';

import { procedureErrorCode, type PlayaPostClient } from '../api/client';

import type { OfflineDatabase, PendingMutationRow } from './database';
import { cacheBoardCard, claimPendingMutations, markMutation, requeueMutation } from './pending-mutations';
import { SYNC_REPLAYED_MUTATION_TYPES } from './replay-routes';

/** Drains the offline queue. One per app; `drain()` is safe to call concurrently. */
export interface SyncRunner {
  drain(): Promise<void>;
}

export interface SyncRunnerOptions {
  readonly database: OfflineDatabase;
  readonly api: PlayaPostClient;
  /** Called once after any drain that changed something, so the views can refetch. */
  onSettled?(): void;
}

/**
 * Replays queued mutations, in order, exactly once each.
 *
 * Two replay routes, chosen by mutation type — see `replay-routes.ts`, whose table
 * `replay-routes.unit.test.ts` holds against `QUEUED_MUTATION_TYPES` so a newly queued
 * type cannot reach production with no route.
 *
 * Nothing here retries on a timer. `attempts` is recorded and displayed; a failed row
 * waits for the next `online` event or an explicit retry. A backoff loop would hide
 * exactly the failures a user needs to see.
 */
export function createSyncRunner(options: SyncRunnerOptions): SyncRunner {
  const { database, api, onSettled } = options;
  let draining: Promise<void> | null = null;

  async function drainOnce(): Promise<void> {
    if (!navigator.onLine) {
      return;
    }

    const claimed = await claimPendingMutations(database);

    if (claimed.length === 0) {
      return;
    }

    await Promise.all(
      claimed.map((row) => markMutation(database, row.mutationId, 'inflight', row.lastError)),
    );

    const batched = claimed.filter((row) => SYNC_REPLAYED_MUTATION_TYPES.includes(row.mutationType));
    const direct = claimed.filter((row) => !SYNC_REPLAYED_MUTATION_TYPES.includes(row.mutationType));

    await replayThroughSync(batched);

    for (const row of direct) {
      await replayDirectly(row);
    }

    onSettled?.();
  }

  async function replayThroughSync(rows: readonly PendingMutationRow[]): Promise<void> {
    if (rows.length === 0) {
      return;
    }

    // The envelope is the stored row, field for field. Re-deriving `payload` here —
    // even to "tidy" it — changes the hash the server computes and turns a `replayed`
    // into a `rejected` / `IDEMPOTENCY_KEY_REUSE`.
    const mutations: readonly MutationEnvelope[] = rows.map((row) => ({
      mutationId: row.mutationId,
      mutationType: row.mutationType,
      clientCreatedAt: row.clientCreatedAt,
      payload: row.payload,
    }));

    let outcomes: readonly MutationOutcome[];

    try {
      outcomes = (await api.mutate('sync.submitMutations', { mutations })).results;
    } catch (error) {
      await returnToQueue(rows, error);
      return;
    }

    const byId = new Map(outcomes.map((outcome) => [outcome.mutationId, outcome]));

    for (const row of rows) {
      const outcome = byId.get(row.mutationId);

      if (outcome === undefined) {
        await requeueMutation(database, row, 'NO_OUTCOME_RETURNED');
        continue;
      }

      await applyOutcome(row, outcome);
    }
  }

  async function applyOutcome(row: PendingMutationRow, outcome: MutationOutcome): Promise<void> {
    switch (outcome.outcome) {
      case 'applied':
      case 'replayed': {
        /*
         * ⚠ Gated on the mutation type, not on the shape of the result. A `PinnedNote`
         * carries an `id` and a `createdAt` too, so `asBulletin` would accept one
         * happily and cache a note as a bulletin on the author's own board — where it
         * does not belong twice over: a note lands on its *recipient's* board, which
         * this device never renders.
         */
        const bulletin =
          row.mutationType === 'bulletin.create' ? asBulletin(outcome.result) : null;

        if (bulletin !== null) {
          await cacheBoardCard(database, { kind: 'own', bulletin });
        }

        await markMutation(database, row.mutationId, 'synced');
        return;
      }

      case 'conflict':
        // Never a silent revert (ADR-0005 §Client): the local optimistic card stays
        // on the board and the row keeps the server's reason for the UI to render.
        await markMutation(
          database,
          row.mutationId,
          'conflicted',
          outcome.conflict?.reason ?? 'CONFLICT',
        );
        return;

      case 'rejected':
        await markMutation(database, row.mutationId, 'failed', outcome.error?.code ?? 'REJECTED');
        return;

      case 'expired':
        await markMutation(database, row.mutationId, 'failed', 'MUTATION_EXPIRED');
        return;
    }
  }

  async function replayDirectly(row: PendingMutationRow): Promise<void> {
    const bulletinId = bulletinIdOf(row.payload);

    if (row.mutationType !== 'bulletin.archive' || bulletinId === null) {
      await markMutation(database, row.mutationId, 'failed', 'UNSUPPORTED_MUTATION_TYPE');
      return;
    }

    try {
      const archived = await api.mutate('bulletins.archive', { bulletinId });

      await cacheBoardCard(database, { kind: 'own', bulletin: archived });
      await markMutation(database, row.mutationId, 'synced');
    } catch (error) {
      await returnToQueue([row], error);
    }
  }

  /**
   * A refusal is terminal; a dropped connection is not.
   *
   * Collapsing the two would either retry a `FORBIDDEN` forever or discard a write
   * because a tunnel ate the request.
   */
  async function returnToQueue(rows: readonly PendingMutationRow[], error: unknown): Promise<void> {
    const code = procedureErrorCode(error);

    for (const row of rows) {
      if (code === null) {
        await requeueMutation(database, row, 'TRANSPORT_UNAVAILABLE');
      } else {
        await markMutation(database, row.mutationId, 'failed', code);
      }
    }
  }

  return {
    drain(): Promise<void> {
      // One drain at a time: two concurrent drains would claim the same `pending` rows
      // and submit each envelope twice. Idempotency would absorb it for
      // `bulletin.create`; nothing would absorb it for the direct route.
      draining ??= drainOnce().finally(() => {
        draining = null;
      });

      return draining;
    },
  };
}

/** `sync.submitMutations` returns handler results as `unknown`; this is the narrowing. */
function asBulletin(result: unknown): Bulletin | null {
  if (typeof result !== 'object' || result === null) {
    return null;
  }

  const candidate = result as Partial<Bulletin>;

  return typeof candidate.id === 'string' && typeof candidate.createdAt === 'string'
    ? (result as Bulletin)
    : null;
}

function bulletinIdOf(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }

  const bulletinId: unknown = (payload as { bulletinId?: unknown }).bulletinId;

  return typeof bulletinId === 'string' ? bulletinId : null;
}

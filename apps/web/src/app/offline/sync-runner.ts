import type { Bulletin, MutationEnvelope, MutationOutcome } from '@playa-post/contracts';

import { applicationErrorCode, procedureErrorCode, type PlayaPostClient } from '../api/client';

import type { OfflineDatabase, PendingMutationRow } from './database';
import { cacheBoardCard, claimPendingMutations, markMutation, requeueMutation } from './pending-mutations';
import { SYNC_REPLAYED_MUTATION_TYPES } from './replay-routes';

/**
 * Drains the offline queue. One per app.
 *
 * `drain()` is safe to call concurrently, and a concurrent call resolves against a pass
 * that could have seen the row the caller just wrote — never against the pass already on
 * the wire, which claimed its rows before that write existed.
 */
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
  /** The pass on the wire, or `null` when nothing is draining. */
  let inFlight: Promise<void> | null = null;
  /** The single follow-up promised to everyone who asked while a pass was running. */
  let followUp: Promise<void> | null = null;

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
   * A whole call that did not land, put back or put down.
   *
   * ⚠ **The merits arrive per envelope, and never here.** `applyOutcome`'s `rejected` is
   * the server having read one write and refused it — that is the refusal channel, and it
   * is terminal. A rejected *call* is the transport or the server's health: a 500, a
   * gateway, a timeout, a rate limit, a tunnel. None of those is an answer about the
   * write, and all of them are worth another try.
   *
   * So only an `applicationCode` — a module's own verdict, attached by `errorFormatter`
   * — marks a row `failed`. A bare envelope code goes back to `pending` carrying that
   * code, because a row put down here renders as "The server refused this note" for a
   * note the server never evaluated.
   */
  async function returnToQueue(rows: readonly PendingMutationRow[], error: unknown): Promise<void> {
    const refusal = applicationErrorCode(error);
    const transport = procedureErrorCode(error) ?? 'TRANSPORT_UNAVAILABLE';

    for (const row of rows) {
      if (refusal === null) {
        await requeueMutation(database, row, transport);
      } else {
        await markMutation(database, row.mutationId, 'failed', refusal);
      }
    }
  }

  function startPass(): Promise<void> {
    const pass = drainOnce().finally(() => {
      inFlight = null;
    });

    inFlight = pass;

    return pass;
  }

  /**
   * One pass at a time, and never a pass that could not have claimed you.
   *
   * Two concurrent passes would claim the same `pending` rows and submit each envelope
   * twice — idempotency would absorb that for `bulletin.create`, and nothing would absorb
   * it for the direct route. But handing a caller the pass already on the wire is its own
   * bug: that pass claimed its rows *before* this caller wrote theirs, so an online pin
   * would settle against a drain that never saw it and report "Queued — will sync when
   * you’re back" to somebody who is not offline.
   *
   * A call arriving mid-pass therefore gets a **follow-up** pass, chained behind the
   * current one. `??=` is what makes a burst of them share the one follow-up rather than
   * each stacking a pass of its own.
   */
  function drain(): Promise<void> {
    if (inFlight === null) {
      return startPass();
    }

    // Both settlements chain to the same continuation: a pass that threw still ended,
    // and the row queued behind it is still owed an attempt of its own.
    followUp ??= inFlight.then(passAfterThisOne, passAfterThisOne);

    return followUp;
  }

  function passAfterThisOne(): Promise<void> {
    followUp = null;

    // Asked again rather than started outright. Between a pass ending and this
    // continuation running there is a tick, and an `online` event landing in it may have
    // started the next pass already — beginning a second here is the double claim.
    return drain();
  }

  return { drain };
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

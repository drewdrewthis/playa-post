import type { OfflineDatabase, PendingMutationRow, PendingMutationState } from '../offline/database';
import { queueMutation } from '../offline/pending-mutations';
import type { SyncRunner } from '../offline/sync-runner';

import { describeSubmissionOutcome, type SubmissionOutcome } from './compose-bulletin-outcome';

export interface SubmitBulletinRequest {
  readonly database: OfflineDatabase;
  readonly syncRunner: SyncRunner;
  /**
   * Built once by the caller and never touched again — the server hashes it to decide
   * replay-versus-duplicate, so rebuilding it later, even from an unchanged form, would
   * break idempotency and move the expiry the user chose.
   */
  readonly payload: unknown;
}

/** A row read back by its mutationId, or which of two ways there is none to find. */
type SettledRow = PendingMutationRow | 'missing' | 'unreadable';

/**
 * Queue a bulletin, drain, and read back what actually happened to it.
 *
 * ⚠ **`pendingMutations.get` returning nothing is not "still queued."** Before
 * `pruneSyncedMutations` existed (issue #174), an absent row could only mean IndexedDB
 * was unreadable, and `pending` was the conservative reading of that. Now a mutationId
 * this call minted and just drained can be absent because it *synced and was swept* — by
 * this drain, by an overlapping one, or by another tab's, none of which serialise against
 * each other. A mutationId this function wrote itself, read back after a drain that did
 * not throw, is what licenses reading that absence as `synced` rather than `pending`
 * (issue #180).
 */
export async function submitBulletin(request: SubmitBulletinRequest): Promise<SubmissionOutcome> {
  const queued = await queueMutation(request.database, {
    mutationType: 'bulletin.create',
    payload: request.payload,
  });

  await request.syncRunner.drain();

  const settled = await readRow(request.database, queued.mutationId);
  const { state, lastError } = settledOutcome(settled);

  return describeSubmissionOutcome(state, lastError);
}

async function readRow(database: OfflineDatabase, mutationId: string): Promise<SettledRow> {
  try {
    return (await database.pendingMutations.get(mutationId)) ?? 'missing';
  } catch {
    return 'unreadable';
  }
}

/** The state and error to describe a settled row as. The one place `missing` becomes `synced`. */
function settledOutcome(settled: SettledRow): {
  readonly state: PendingMutationState;
  readonly lastError: string | null;
} {
  if (settled === 'missing') {
    return { state: 'synced', lastError: null };
  }

  if (settled === 'unreadable') {
    // A store that cannot be read is not a store that lost the write. `pending` is the
    // state the row was written in, and the caller reads an unreadable row as that.
    return { state: 'pending', lastError: null };
  }

  return { state: settled.state, lastError: settled.lastError };
}

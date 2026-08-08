import type { PendingMutationRow, PendingMutationState } from './database';

/**
 * How urgent a queued row is, in three tones rather than the comp's two.
 *
 * The comp tints a pill warn or ok. That is right for `pending` and `synced` and wrong
 * for `failed` and `conflicted`: amber reads as "still working on it", and a user who
 * reads a conflict that way waits for something that will never resolve itself.
 */
export type QueueTone = 'waiting' | 'good' | 'bad';

/** One row of the SYNC section. */
export interface QueuedMutationView {
  readonly text: string;
  readonly pill: string;
  readonly tone: QueueTone;
}

/**
 * ⚠ Deliberately not `pending-badge.tsx`'s `STATE_LABEL`, which reads "Waiting to sync".
 * That badge is one line of chrome explaining itself to somebody who was not looking for
 * it; this is a column of pills beside a list of items, where the sentence repeats five
 * times and the comp's tracked caps are what make the column scannable. Same five states,
 * two presentations — sharing one string would make one of the two read badly.
 */
const PILL: Record<PendingMutationState, string> = {
  pending: 'PENDING',
  inflight: 'SYNCING',
  failed: 'FAILED',
  conflicted: 'CONFLICT',
  synced: 'SYNCED',
};

const TONE: Record<PendingMutationState, QueueTone> = {
  pending: 'waiting',
  inflight: 'waiting',
  failed: 'bad',
  conflicted: 'bad',
  synced: 'good',
};

/** What this build knows how to name. Anything else falls back to its type. */
const NOUN: Record<string, string> = {
  'bulletin.create': 'Bulletin',
  'bulletin.archive': 'Archived bulletin',
};

/**
 * A queued payload's title, if it has a usable one.
 *
 * ⚠ `payload` is `unknown` and it is **stored**, so it outlives the build that wrote it —
 * an older row may carry a shape this version has never seen. Narrowing rather than
 * casting is what keeps a strange row a plain label instead of a crash on a screen whose
 * whole job is to account for work that has not landed.
 */
function titleOf(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null || !('title' in payload)) {
    return null;
  }

  const { title } = payload as { title: unknown };

  return typeof title === 'string' && title.trim() !== '' ? title : null;
}

/** One queued mutation, as the You screen's SYNC section renders it. */
export function describeQueuedMutation(row: PendingMutationRow): QueuedMutationView {
  const noun = NOUN[row.mutationType] ?? row.mutationType;
  const title = row.mutationType === 'bulletin.create' ? titleOf(row.payload) : null;

  return {
    text: title === null ? noun : `${noun} · ${title}`,
    pill: PILL[row.state],
    tone: TONE[row.state],
  };
}

/**
 * The queue in the order the drainer will replay it — oldest first
 * (`claimPendingMutations`).
 *
 * A copy, never a sort in place: `useLiveQuery` hands back the array Dexie owns, and
 * reordering it under the store is how a list starts disagreeing with itself between
 * renders.
 */
export function sortedQueue(
  rows: readonly PendingMutationRow[],
): readonly PendingMutationRow[] {
  return [...rows].sort((left, right) =>
    left.clientCreatedAt.localeCompare(right.clientCreatedAt),
  );
}

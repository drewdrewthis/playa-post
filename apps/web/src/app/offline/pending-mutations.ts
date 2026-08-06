import type { CachedBoardCard, OfflineDatabase, PendingMutationRow, PendingMutationState } from './database';

/**
 * The mutation types this client queues.
 *
 * ⚠ Narrower than ADR-0005's matrix on purpose: these are the ones M2's UI can
 * produce. A type queued here must have a replay route in `sync-runner.ts` — queuing
 * one the client cannot replay is a row that sits `pending` forever with no affordance
 * to clear it.
 */
export const QUEUED_MUTATION_TYPES = ['bulletin.create', 'bulletin.archive'] as const;

/** One of {@link QUEUED_MUTATION_TYPES}. */
export type QueuedMutationType = (typeof QUEUED_MUTATION_TYPES)[number];

/** What a caller supplies; the envelope's identity and clock are minted here. */
export interface QueueMutationCommand {
  readonly mutationType: QueuedMutationType;
  readonly payload: unknown;
  /** Applied to `cachedBoard` immediately. Local, reversible, never a server claim. */
  readonly optimisticCard?: CachedBoardCard;
}

/**
 * Queue one mutation.
 *
 * **Online and offline take this same path.** Routing an online write straight to the
 * network and only queueing when `navigator.onLine` is false would make the offline
 * branch the rarely-exercised one — and a replay path that only runs on a bad network
 * is a replay path nobody has tested.
 */
export async function queueMutation(
  database: OfflineDatabase,
  command: QueueMutationCommand,
): Promise<PendingMutationRow> {
  const row: PendingMutationRow = {
    mutationId: crypto.randomUUID(),
    mutationType: command.mutationType,
    clientCreatedAt: new Date().toISOString(),
    payload: command.payload,
    state: 'pending',
    attempts: 0,
    lastError: null,
  };

  await database.pendingMutations.add(row);

  if (command.optimisticCard !== undefined) {
    await cacheBoardCard(database, command.optimisticCard);
  }

  return row;
}

/** Move a row to a new state, recording whatever the server (or the network) said. */
export async function markMutation(
  database: OfflineDatabase,
  mutationId: string,
  state: PendingMutationState,
  lastError: string | null = null,
): Promise<void> {
  await database.pendingMutations.update(mutationId, { state, lastError });
}

/** Record one more attempt and return the row to `pending` for the next drain. */
export async function requeueMutation(
  database: OfflineDatabase,
  row: PendingMutationRow,
  lastError: string,
): Promise<void> {
  await database.pendingMutations.update(row.mutationId, {
    state: 'pending',
    attempts: row.attempts + 1,
    lastError,
  });
}

/** The queue, oldest first — the order the server must see them in. */
export async function claimPendingMutations(
  database: OfflineDatabase,
): Promise<readonly PendingMutationRow[]> {
  const pending = await database.pendingMutations.where('state').equals('pending').toArray();

  return [...pending].sort((left, right) =>
    left.clientCreatedAt.localeCompare(right.clientCreatedAt),
  );
}

/** Write one card into the board cache, replacing any earlier version of it. */
export async function cacheBoardCard(
  database: OfflineDatabase,
  card: CachedBoardCard,
): Promise<void> {
  await database.cachedBoard.put({
    id: card.bulletin.id,
    card,
    createdAt: card.bulletin.createdAt,
    cachedAt: new Date().toISOString(),
  });
}

/** Drop a card the viewer has hidden. Viewer-local, and never sent to the author. */
export async function forgetBoardCard(
  database: OfflineDatabase,
  bulletinId: string,
): Promise<void> {
  await database.cachedBoard.delete(bulletinId);
}

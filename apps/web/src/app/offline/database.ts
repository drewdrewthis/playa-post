import Dexie, { type Table } from 'dexie';

import type { Bulletin, Person, VisibleBulletin } from '@playa-post/contracts';

/**
 * Where a queued mutation is in its life (ADR-0005 §Client).
 *
 * Exactly five states, and every one of them is visible in the UI: a state a user
 * cannot see is a state they cannot recover from. `conflicted` in particular is never
 * resolved by silently reverting the local change — that is the failure mode the whole
 * protocol exists to prevent.
 */
export type PendingMutationState = 'pending' | 'inflight' | 'failed' | 'conflicted' | 'synced';

/** Every state in which the badge must be visible: everything that is not settled. */
export const UNSETTLED_MUTATION_STATES: readonly PendingMutationState[] = [
  'pending',
  'inflight',
  'failed',
  'conflicted',
];

/**
 * One queued mutation, exactly as it will be replayed.
 *
 * ⚠ **`mutationId` is minted once and `payload` is frozen at write time.** The server
 * computes `request_hash` as SHA-256 over canonical JSON of the payload, so a client
 * that re-serialises, re-orders, or normalises the payload between attempts gets
 * `rejected` / `IDEMPOTENCY_KEY_REUSE` instead of `replayed`; a client that mints a
 * fresh `mutationId` on retry creates a duplicate the server has no way to detect.
 * Store the object; let the transport serialise it.
 */
export interface PendingMutationRow {
  readonly mutationId: string;
  readonly mutationType: string;
  /** ISO-8601. Ordering only — never conflict resolution; client clocks are unreliable. */
  readonly clientCreatedAt: string;
  readonly payload: unknown;
  readonly state: PendingMutationState;
  readonly attempts: number;
  /** The server's stable code, or a transport failure's name. `null` while healthy. */
  readonly lastError: string | null;
}

/** One person from the last `graph.list`, kept so the graph renders offline. */
export interface CachedGraphRow {
  readonly userId: string;
  readonly person: Person;
  readonly cachedAt: string;
}

/**
 * One board card.
 *
 * `own` carries the author's view (it has `archivedAt`, the only place archived-ness
 * is observable); `visible` carries an eligible viewer's view (it has the §6a author
 * card). A card is one or the other, never a merge of both, because the two read
 * models answer different questions and flattening them would invent a field.
 */
export type CachedBoardCard =
  | { readonly kind: 'own'; readonly bulletin: Bulletin }
  | { readonly kind: 'visible'; readonly bulletin: VisibleBulletin };

export interface CachedBoardRow {
  readonly id: string;
  readonly card: CachedBoardCard;
  readonly createdAt: string;
  readonly cachedAt: string;
}

/** Scalars the sync loop needs to remember across reloads. */
export interface SyncMetaRow {
  readonly key: string;
  readonly value: unknown;
}

/**
 * The four ADR-0005 stores, and no fifth.
 *
 * Declared as an intersection over a plain `Dexie` instance rather than as a subclass
 * with class fields: with `target: ES2022` TypeScript emits real field definitions,
 * which overwrite the tables Dexie installs on the instance and leave every table
 * `undefined` at runtime. This is the shape Dexie's own TypeScript guidance gives.
 */
export type OfflineDatabase = Dexie & {
  pendingMutations: Table<PendingMutationRow, string>;
  cachedGraph: Table<CachedGraphRow, string>;
  cachedBoard: Table<CachedBoardRow, string>;
  syncMeta: Table<SyncMetaRow, string>;
};

/** Build the offline database. One per browser context; the app builds exactly one. */
export function createOfflineDatabase(name = 'playa-post'): OfflineDatabase {
  const database = new Dexie(name) as OfflineDatabase;

  database.version(1).stores({
    // Indexed on `state` and `clientCreatedAt` because the drainer's only query is
    // "the pending ones, oldest first" — replaying out of order would apply a later
    // edit before the create it depends on.
    pendingMutations: 'mutationId, state, clientCreatedAt',
    cachedGraph: 'userId',
    cachedBoard: 'id, createdAt',
    syncMeta: 'key',
  });

  return database;
}

/** The app's single offline database. */
export const offlineDatabase: OfflineDatabase = createOfflineDatabase();

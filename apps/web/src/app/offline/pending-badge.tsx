import { useLiveQuery } from 'dexie-react-hooks';
import type { JSX } from 'react';

import { UNSETTLED_MUTATION_STATES, type PendingMutationState } from './database';
import { useOffline } from './offline-provider';

/** Copy per state. Five distinct affordances, because five distinct things happened. */
const STATE_LABEL: Record<PendingMutationState, string> = {
  pending: 'Waiting to sync',
  inflight: 'Syncing',
  failed: 'Sync failed',
  conflicted: 'Needs your decision',
  synced: 'Synchronized',
};

/**
 * The queue, in the app shell header.
 *
 * ⚠ **Rendered only while something is unsettled.** A badge that is always present,
 * reading "Synchronized" when the queue is empty, is a badge users stop seeing — and
 * the one thing it has to do is be noticeable when a write has not landed yet. Once
 * everything is `synced` it is absent from the DOM.
 *
 * `useLiveQuery` rather than a second copy of the queue in React state: the store is
 * already the source of truth, and a mirrored copy is a mirror that can be wrong.
 */
export function OfflinePendingBadge(): JSX.Element | null {
  const { database } = useOffline();

  const unsettled = useLiveQuery(
    () => database.pendingMutations.where('state').anyOf([...UNSETTLED_MUTATION_STATES]).toArray(),
    [database],
    [],
  );

  if (unsettled.length === 0) {
    return null;
  }

  // The most alarming state wins the badge: a conflict a user must resolve should not
  // be hidden behind "Syncing" because a later write is still in flight.
  const worst =
    unsettled.find((row) => row.state === 'conflicted') ??
    unsettled.find((row) => row.state === 'failed') ??
    unsettled.find((row) => row.state === 'inflight') ??
    unsettled[0];

  const state: PendingMutationState = worst?.state ?? 'pending';

  return (
    <span
      data-testid="offline-pending-badge"
      data-state={state}
      className={`pending-badge pending-badge--${state}`}
      role="status"
    >
      {STATE_LABEL[state]}
      {unsettled.length > 1 ? ` (${String(unsettled.length)})` : ''}
      {worst?.lastError === null || worst?.lastError === undefined ? '' : ` — ${worst.lastError}`}
    </span>
  );
}

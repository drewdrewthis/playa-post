import { describe, expect, it } from 'vitest';

import { QUEUED_MUTATION_TYPES } from '../offline/pending-mutations';
import {
  DIRECTLY_REPLAYED_MUTATION_TYPES,
  SYNC_REPLAYED_MUTATION_TYPES,
} from '../offline/replay-routes';

/**
 * `intros.request` is an **online-only** mutation, and this is where that decision is
 * held.
 *
 * ⚠ Queueing it would look more robust and be strictly less so. Eligibility is
 * time-varying — the graph moves, a target lowers their reach setting, the pair's ask
 * gets answered — and ADR-0005's conflict matrix does not define this type, so
 * `composition/container.ts` has no handler for it: a queued envelope comes back
 * `rejected` / `UNSUPPORTED_MUTATION_TYPE` and the request silently never happens. The
 * same reasoning `notifications-mutation.ts` records for `notifications.dismiss`.
 *
 * Held here rather than by editing `offline/replay-routes.unit.test.ts`, which is about
 * the queue and the drainer agreeing with each other and passes untouched.
 */
describe('requesting an intro', () => {
  const queued: readonly string[] = QUEUED_MUTATION_TYPES;

  it('is never queued for replay', () => {
    expect(queued).not.toContain('intros.request');
    expect(queued).not.toContain('intro.request');
  });

  it('has no replay route, on either path', () => {
    expect(SYNC_REPLAYED_MUTATION_TYPES).not.toContain('intros.request');
    expect(DIRECTLY_REPLAYED_MUTATION_TYPES).not.toContain('intros.request');
  });

  // Deciding is the same call from the other side of the request, and is refused for the
  // same reason: a decision replayed from a queue is a decision made against a graph that
  // has moved since.
  it('neither is deciding one', () => {
    expect(queued).not.toContain('intros.decide');
    expect(SYNC_REPLAYED_MUTATION_TYPES).not.toContain('intros.decide');
    expect(DIRECTLY_REPLAYED_MUTATION_TYPES).not.toContain('intros.decide');
  });
});

import { describe, expect, it } from 'vitest';

import { QUEUED_MUTATION_TYPES } from './pending-mutations';
import { DIRECTLY_REPLAYED_MUTATION_TYPES, SYNC_REPLAYED_MUTATION_TYPES } from './replay-routes';

/**
 * The queue and the drainer, held together.
 *
 * A type this client queues with no route home is a row that sits `pending` forever with
 * no affordance to clear it — and nothing in the UI distinguishes that from a bad
 * network, so the failure is invisible until somebody's write is already lost in it.
 * Neither list can be edited alone without this failing.
 */
describe('replay routes', () => {
  const routed = [...SYNC_REPLAYED_MUTATION_TYPES, ...DIRECTLY_REPLAYED_MUTATION_TYPES];

  it('gives every queued mutation type a replay route', () => {
    for (const type of QUEUED_MUTATION_TYPES) {
      expect(routed, `${type} is queued with no replay route`).toContain(type);
    }
  });

  it('routes each type exactly one way, so a drain cannot submit one twice', () => {
    expect(new Set(routed).size).toBe(routed.length);
  });

  it('routes nothing this client never queues', () => {
    for (const type of routed) {
      expect(QUEUED_MUTATION_TYPES, `${type} has a route but is never queued`).toContain(type);
    }
  });

  /*
   * ⚠ `note.pin` belongs on the idempotent path and nowhere else. It has a real handler
   * in `composition/container.ts`, so a replayed envelope comes back carrying the first
   * result and writes one note; replayed directly it would be an ordinary `notes.pin`
   * call, and a drain that ran twice would leave two notes on somebody's board.
   */
  it('replays note.pin through sync, which is the only path that deduplicates it', () => {
    expect(SYNC_REPLAYED_MUTATION_TYPES).toContain('note.pin');
    expect(DIRECTLY_REPLAYED_MUTATION_TYPES).not.toContain('note.pin');
  });
});

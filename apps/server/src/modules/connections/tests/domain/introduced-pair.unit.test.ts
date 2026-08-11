import { describe, expect, it } from 'vitest';

import {
  INTRO_ACCEPTED,
  toIntroducedPair,
  type IntroAcceptedEnvelope,
} from '../../domain/introduced-pair';

/**
 * `specs/features/request-an-intro.feature` › "Accepting a passed-on introduction connects
 * the target to the requester" — the reading half (`@unit`, issue #166).
 *
 * Decision D12 makes this module the one that writes an intro-formed connection, and an
 * outbox payload is the whole of what it is told. That payload is durable, arrives from
 * another module, and can be delivered again days later — so what it is read *as* is worth
 * pinning independently of Postgres, the same split `modules/audit` makes between
 * `toAuditEntry` and its handler.
 */
describe('reading an IntroAccepted as the pair to connect (issue #166)', () => {
  const introRequestId = '11111111-1111-4111-8111-111111111111';
  const requesterId = '22222222-2222-4222-8222-222222222222';
  const targetId = '33333333-3333-4333-8333-333333333333';
  const occurredAt = new Date('2026-08-12T07:15:00.000Z');

  const envelope: IntroAcceptedEnvelope = {
    eventType: INTRO_ACCEPTED,
    aggregateId: introRequestId,
    occurredAt,
    payload: { introRequestId, requesterId, viaId: 'unused', targetId },
  };

  it('subscribes to the name modules/intros publishes, restated rather than imported', () => {
    // ADR-0006 makes the *name* the contract. The string is duplicated on purpose and the
    // type is not — a change to intros' internal interface must not ripple in here, and a
    // change to the published name must surface as a consumer that stops matching.
    expect(INTRO_ACCEPTED).toBe('IntroAccepted');
  });

  it('names the two people to connect, and neither the via nor anybody else', () => {
    expect(toIntroducedPair(envelope)).toEqual({
      introRequestId,
      requesterId,
      targetId,
      occurredAt,
    });
  });

  it('takes the intro request from the envelope’s aggregate, not the payload’s copy', () => {
    // The drainer read `aggregate_id` off the row itself, so it cannot disagree with the
    // event it arrived on — a payload that carried a different id would be correlating
    // the connection to somebody else's introduction.
    const disagreeing: IntroAcceptedEnvelope = {
      ...envelope,
      payload: { ...envelope.payload, introRequestId: '99999999-9999-4999-8999-999999999999' },
    };

    expect(toIntroducedPair(disagreeing).introRequestId).toBe(introRequestId);
  });

  it('dates the connection by when the target accepted, never by delivery', () => {
    // ⚠ A redelivery days later must not write a connection claiming to have formed then.
    // It is also what makes the write deterministic: the same event always produces the
    // same row.
    expect(toIntroducedPair(envelope).occurredAt).toBe(occurredAt);
  });

  it('refuses an event that names no requester, no target, or the same person twice', () => {
    // ⚠ A throw rather than a skip or a guess. Only `modules/intros` writes this event, so
    // a payload missing a party is a publisher bug, and ADR-0006's retry-then-dead-letter
    // path is where a publisher bug is supposed to surface. Falling back to the envelope's
    // `actor_id` would connect a guess; skipping would lose the connection in silence.
    for (const payload of [
      { targetId },
      { requesterId },
      { requesterId, targetId: '' },
      { requesterId: 42, targetId },
      { requesterId: targetId, targetId },
    ]) {
      expect(() => toIntroducedPair({ ...envelope, payload }), JSON.stringify(payload)).toThrow(
        /no distinct pair/,
      );
    }
  });
});

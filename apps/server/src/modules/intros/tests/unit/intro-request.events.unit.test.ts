import { describe, expect, it } from 'vitest';

import { INTRO_REQUEST_STATUS, type IntroRequest } from '../../domain/intro-request';
import {
  INTRO_DECLINED,
  INTRO_PASSED_ON,
  INTRO_REQUESTED,
  introDecided,
  introRequested,
} from '../../domain/intro-request.events';

/**
 * `specs/features/request-an-intro.feature` › "No event payload carries the note"
 * (`@unit`, issue #89) — the unit half of AC13.
 *
 * ⚠ The absence is asserted over `JSON.stringify` of the whole event, not over a field
 * list. A field list goes green the day somebody adds a `context` object with the note
 * inside it; the serialized form is what actually lands in `app.outbox_events.payload`
 * and in every log line that dumps one, so that is what is checked.
 *
 * The phrase is deliberately distinctive — an outbox payload is full of UUIDs and
 * timestamps, and a search for "coffee" would match nothing whether or not the rule held.
 */
describe('intro request events (issue #89, ADR-0006)', () => {
  const DISTINCTIVE_PHRASE = 'obsidian-marigold-thunderhead';

  const open: IntroRequest = {
    id: '11111111-1111-4111-8111-111111111111',
    requesterId: '22222222-2222-4222-8222-222222222222',
    viaId: '33333333-3333-4333-8333-333333333333',
    targetId: '44444444-4444-4444-8444-444444444444',
    note: `We should talk about the ${DISTINCTIVE_PHRASE}.`,
    status: INTRO_REQUEST_STATUS.requested,
    createdAt: new Date('2026-08-11T09:00:00.000Z'),
  };

  const decidedAt = new Date('2026-08-11T10:30:00.000Z');
  const passedOn: IntroRequest = {
    ...open,
    status: INTRO_REQUEST_STATUS.passedOn,
    decidedAt,
  };
  const declined: IntroRequest = {
    ...open,
    status: INTRO_REQUEST_STATUS.declined,
    decidedAt,
  };

  describe('introRequested', () => {
    it('carries the four identifiers a consumer routes on, and nothing else', () => {
      expect(introRequested(open)).toEqual({
        type: INTRO_REQUESTED,
        occurredAt: open.createdAt,
        introRequestId: open.id,
        requesterId: open.requesterId,
        viaId: open.viaId,
        targetId: open.targetId,
        actorId: open.requesterId,
      });
    });

    it('never carries the note', () => {
      expect(JSON.stringify(introRequested(open))).not.toContain(DISTINCTIVE_PHRASE);
    });

    it('takes occurredAt from the stored row, not from a clock the builder reads', () => {
      // The event describes what the database committed. A second clock reading here
      // would let the row and the event disagree about when the thing happened.
      expect(introRequested(open).occurredAt).toBe(open.createdAt);
    });
  });

  describe('introDecided', () => {
    it('names the actor as the via — the requester never decides', () => {
      expect(introDecided(passedOn).actorId).toBe(open.viaId);
    });

    it('reads its type from the stored status rather than from a second argument', () => {
      // One builder for both decisions, so the emitted type cannot disagree with what
      // was written. A `decision` parameter would be a second source of truth that
      // compiles just as happily when it is wrong.
      expect(introDecided(passedOn).type).toBe(INTRO_PASSED_ON);
      expect(introDecided(declined).type).toBe(INTRO_DECLINED);
    });

    it('takes occurredAt from the committed decided_at', () => {
      expect(introDecided(passedOn).occurredAt).toBe(decidedAt);
    });

    it('carries the same four identifiers for a decline as for a pass-on', () => {
      const { type: _passedOnType, ...passedOnPayload } = introDecided(passedOn);
      const { type: _declinedType, ...declinedPayload } = introDecided(declined);

      // ⚠ Identical payloads on purpose. The row that must never be *delivered* to the
      // target is `IntroDeclined`, and that is a consumer's rule; the audit trail is
      // entitled to the same four identifiers either way, and one payload shape for
      // three events beats three that could drift.
      expect(declinedPayload).toEqual(passedOnPayload);
    });

    it('never carries the note, on either decision', () => {
      expect(JSON.stringify(introDecided(passedOn))).not.toContain(DISTINCTIVE_PHRASE);
      expect(JSON.stringify(introDecided(declined))).not.toContain(DISTINCTIVE_PHRASE);
    });

    it('refuses to build an event for a row that carries no decision', () => {
      // Not an `ApplicationError`: no caller can produce this, so it is a programming
      // mistake rather than a refusal — and silently emitting an `IntroDeclined` for an
      // undecided row would be worse than a 500.
      expect(() => introDecided(open)).toThrow(/carries no decision/);
    });
  });
});

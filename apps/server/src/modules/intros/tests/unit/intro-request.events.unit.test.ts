import { describe, expect, it } from 'vitest';

import { INTRO_REQUEST_STATUS, type IntroRequest } from '../../domain/intro-request';
import {
  INTRO_ACCEPTED,
  INTRO_DECLINED,
  INTRO_PASSED_ON,
  INTRO_REQUESTED,
  INTRO_TARGET_DECLINED,
  introDecided,
  introRequested,
  introResponded,
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
  /*
   * A second phrase, because the two notes have two authors and only one of them is on an
   * open row (issue #175). Asserting the requester's absence alone would go green on an
   * `IntroPassedOn` that quoted the via's vouch — which is the one event a notification
   * consumer would most like to put in a push body, and therefore the one this has to
   * catch.
   */
  const DISTINCTIVE_VIA_PHRASE = 'cinnabar-lantern-switchback';

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
    viaNote: `Worth an hour of yours — the ${DISTINCTIVE_VIA_PHRASE}.`,
    decidedAt,
  };
  const declined: IntroRequest = {
    ...open,
    status: INTRO_REQUEST_STATUS.declined,
    decidedAt,
  };

  /** The target's own timestamp, deliberately not the via's (issue #166). */
  const respondedAt = new Date('2026-08-11T18:45:00.000Z');
  const accepted: IntroRequest = {
    ...passedOn,
    status: INTRO_REQUEST_STATUS.accepted,
    respondedAt,
  };
  const targetDeclined: IntroRequest = {
    ...passedOn,
    status: INTRO_REQUEST_STATUS.targetDeclined,
    respondedAt,
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

    it('never carries the via’s own note either (#175)', () => {
      // ⚠ Same assertion shape and the same reason: an outbox row is durable and widely
      // read, so a consumer re-reads the vouch through this module's authorized target
      // read or it does not get it at all. A `context` object added later cannot smuggle
      // it back in, because this is measured over the serialized whole.
      expect(JSON.stringify(introDecided(passedOn))).not.toContain(DISTINCTIVE_VIA_PHRASE);
    });

    it('builds the identical payload whether or not the row carries a via note', () => {
      // The vouch changes what the target reads and changes nothing a consumer routes
      // on — so the event for a row with one is byte-for-byte the event for a row
      // without, which is the strongest form of "the payload does not depend on it".
      const { viaNote: _viaNote, ...withoutViaNote } = passedOn;

      expect(introDecided(passedOn)).toEqual(introDecided(withoutViaNote));
    });

    it('refuses to build an event for a row that carries no decision', () => {
      // Not an `ApplicationError`: no caller can produce this, so it is a programming
      // mistake rather than a refusal — and silently emitting an `IntroDeclined` for an
      // undecided row would be worse than a 500.
      expect(() => introDecided(open)).toThrow(/carries no decision/);
    });

    it('refuses an answered row rather than calling it a decline (#166)', () => {
      // ⚠ The regression this pins is the shape the builder used to have: "passed on,
      // else declined". Since #166 a decided row can also be `accepted` — the target
      // answered a request the via had passed on — and the negative form would have
      // announced an `IntroDeclined` the via never made, to consumers routing on it.
      expect(() => introDecided(accepted)).toThrow(/not a via decision/);
      expect(() => introDecided(targetDeclined)).toThrow(/not a via decision/);
    });
  });

  describe('introResponded (issue #166)', () => {
    it('names the actor as the target — neither the requester nor the via answers', () => {
      expect(introResponded(accepted).actorId).toBe(open.targetId);
      expect(introResponded(targetDeclined).actorId).toBe(open.targetId);
    });

    it('reads its type from the stored status rather than from a second argument', () => {
      expect(introResponded(accepted).type).toBe(INTRO_ACCEPTED);
      expect(introResponded(targetDeclined).type).toBe(INTRO_TARGET_DECLINED);
    });

    it('takes occurredAt from responded_at and never from the via’s decided_at', () => {
      // ⚠ The two timestamps belong to two different people. An acceptance stamped with
      // the via's decision time would tell every consumer — the audit trail included —
      // that the target answered before they were shown anything.
      expect(introResponded(accepted).occurredAt).toBe(respondedAt);
      expect(introResponded(accepted).occurredAt).not.toBe(decidedAt);
    });

    it('carries the identifiers modules/connections needs to form the edge', () => {
      // The seam decision D12 rests on: the connection is written from this payload, so
      // the two people it names are the whole contract. Nothing was added for it — these
      // are the same identifiers every intro event has carried since #89.
      expect(introResponded(accepted)).toEqual({
        type: INTRO_ACCEPTED,
        occurredAt: respondedAt,
        introRequestId: open.id,
        requesterId: open.requesterId,
        viaId: open.viaId,
        targetId: open.targetId,
        actorId: open.targetId,
      });
    });

    it('carries the same identifiers for a decline as for an acceptance', () => {
      const { type: _acceptedType, ...acceptedPayload } = introResponded(accepted);
      const { type: _declinedType, ...declinedPayload } = introResponded(targetDeclined);

      // ⚠ Identical payloads, exactly as the via's two decisions have. The row that must
      // never be *delivered* to the requester is `IntroTargetDeclined`, and that is a
      // consumer's rule rather than a payload one — there is no consumer for it at all.
      expect(declinedPayload).toEqual(acceptedPayload);
    });

    it('carries neither note, on either answer', () => {
      // Same assertion shape and the same reason as the via's events: an answered row
      // still carries both notes, and an outbox row is durable and widely read.
      for (const event of [introResponded(accepted), introResponded(targetDeclined)]) {
        expect(JSON.stringify(event)).not.toContain(DISTINCTIVE_PHRASE);
        expect(JSON.stringify(event)).not.toContain(DISTINCTIVE_VIA_PHRASE);
      }
    });

    it('refuses to build an event for a row nobody has answered', () => {
      expect(() => introResponded(open)).toThrow(/carries no answer/);
      expect(() => introResponded(passedOn)).toThrow(/carries no answer/);
    });

    it('refuses a via decision rather than calling it an answer', () => {
      // The mirror of `introDecided`'s guard: a row whose `responded_at` was set while its
      // status stayed `passed_on` is unreachable through the gated update and would be a
      // fact about the wrong person if it were ever built.
      expect(() => introResponded({ ...passedOn, respondedAt })).toThrow(
        /not a target answer/,
      );
    });
  });
});

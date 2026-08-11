import { describe, expect, it } from 'vitest';

import {
  ANSWERED_STATUSES,
  INTRO_DECISION,
  INTRO_REQUEST_STATUS,
  INTRO_RESPONSE,
  STATUS_FOR_DECISION,
  STATUS_FOR_RESPONSE,
} from '../../domain/intro-request';
import { IntroUnavailableError } from '../../domain/intro-request.errors';

/**
 * `specs/features/request-an-intro.feature` › the target's answer (`@unit`, issue #166).
 *
 * The transition *matrix* — who may answer, from which state, and how many times — is one
 * `where` clause on one gated UPDATE and is proven against a real Postgres in
 * `request-an-intro.integration.test.ts`. Asserting it here would mean re-implementing the
 * rule in a fake, which is the shape this repository refuses: a second answer to an
 * authorization question, in the only place that cannot enforce it.
 *
 * What *is* unit-testable is the vocabulary the statement is built from, and it is
 * load-bearing in three ways. A response that mapped to the wrong status would connect the
 * wrong people; a target status that collided with the via's `declined` would widen every
 * read that filters on it; and a refusal with its own code would tell a target the one
 * thing a via's decline exists to hide.
 */
describe('the target’s answer to an introduction (issue #166)', () => {
  describe('the two vocabularies stay apart', () => {
    it('gives a response its own values, so no caller can submit a via decision as a target', () => {
      // ⚠ `pass_on` must not be reachable through `INTRO_RESPONSE`. There is no statement
      // in this module that implements "the target passes it on", so a shared union would
      // describe a transition nothing can perform — and would put the two actors'
      // authorization rules behind one type an `if` could cross.
      expect(Object.values(INTRO_RESPONSE)).toEqual(['accept', 'decline']);
      expect(Object.values(INTRO_RESPONSE)).not.toContain(INTRO_DECISION.passOn);
    });

    it('shares only the word decline, and maps it to a different status', () => {
      // The one overlap, and the reason the statuses may not overlap with it: "the via
      // would not pass it on" and "the target read it and said no" are different facts
      // about different people.
      expect(INTRO_RESPONSE.decline).toBe(INTRO_DECISION.decline);
      expect(STATUS_FOR_RESPONSE[INTRO_RESPONSE.decline]).not.toBe(
        STATUS_FOR_DECISION[INTRO_DECISION.decline],
      );
    });
  });

  describe('STATUS_FOR_RESPONSE', () => {
    it('is total over the responses and maps each to its own terminal status', () => {
      expect(STATUS_FOR_RESPONSE).toEqual({
        accept: INTRO_REQUEST_STATUS.accepted,
        decline: INTRO_REQUEST_STATUS.targetDeclined,
      });
      expect(Object.keys(STATUS_FOR_RESPONSE).sort()).toEqual(
        Object.values(INTRO_RESPONSE).sort(),
      );
    });

    it('produces statuses no via decision can produce', () => {
      // Disjoint sets, asserted rather than assumed: a target answer that collided with
      // `passed_on` would make an answered introduction answerable again, and one that
      // collided with `declined` would make it invisible to its own target.
      const fromDecisions = new Set(Object.values(STATUS_FOR_DECISION));

      for (const status of Object.values(STATUS_FOR_RESPONSE)) {
        expect(fromDecisions.has(status)).toBe(false);
      }
    });
  });

  describe('ANSWERED_STATUSES', () => {
    it('holds exactly the statuses a response produces', () => {
      // Derived rather than restated, so "a request the target has answered" cannot drift
      // from "a status a response produces" — the two are one claim.
      expect([...ANSWERED_STATUSES].sort()).toEqual(Object.values(STATUS_FOR_RESPONSE).sort());
    });

    it('excludes every state that predates an answer', () => {
      for (const status of [
        INTRO_REQUEST_STATUS.requested,
        INTRO_REQUEST_STATUS.passedOn,
        INTRO_REQUEST_STATUS.declined,
      ]) {
        expect(ANSWERED_STATUSES.has(status)).toBe(false);
      }
    });
  });

  describe('the refusal', () => {
    it('answers every reason with the one INTRO_UNAVAILABLE code and message', () => {
      // ⚠ **No new error class for this path, deliberately.** "Not yours to answer",
      // "already answered", "still waiting on the via" and "the via declined it" are one
      // answer, and the last one is why: a distinct refusal for a declined request would
      // let a target detect a decline by trying to accept it, which is exactly the
      // indistinguishability that makes declining safe for the via (ADR-0002 §10, B17).
      expect(IntroUnavailableError.code).toBe('INTRO_UNAVAILABLE');
      expect(new IntroUnavailableError().message).toBe('That introduction is not available.');
    });

    it('says nothing about the introduction it refused', () => {
      // The message must never grow a detail. "Already answered", "not passed on yet", or
      // an echoed identifier each turn this error back into the oracle it exists to close.
      const { message } = new IntroUnavailableError();

      expect(message).not.toMatch(/answer|accept|declin|target|via|passed/i);
    });
  });
});

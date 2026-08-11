import { describe, expect, it } from 'vitest';

import { INTRO_DECISION, INTRO_REQUEST_STATUS, INTRO_RESPONSE } from '../../domain/intro-request';
import {
  respondToIntroCommandFields,
  respondToIntroInput,
} from '../../transport/respond-to-intro.input';

/**
 * `specs/features/request-an-intro.feature` › the target's answer — the wire half
 * (`@unit`, issue #166).
 *
 * The schema is one `strictObject` with an enum rather than `decide-intro.input.ts`'s
 * discriminated union, and the difference is the subject of half of what follows: both
 * answers take exactly the same fields, so a union would be two identical arms pretending
 * to describe a difference. What the strictness buys is the same thing it buys next door —
 * a field written for a reader who does not exist is refused rather than dropped.
 */
describe('respondToIntroInput', () => {
  const introRequestId = '11111111-1111-4111-8111-111111111111';

  describe('the two answers', () => {
    it('accepts an acceptance', () => {
      expect(respondToIntroInput.parse({ introRequestId, response: INTRO_RESPONSE.accept })).toEqual(
        { introRequestId, response: 'accept' },
      );
    });

    it('accepts a decline, which takes no more fields than an acceptance does', () => {
      expect(
        respondToIntroInput.parse({ introRequestId, response: INTRO_RESPONSE.decline }),
      ).toEqual({ introRequestId, response: 'decline' });
    });

    it('refuses an answer with no response at all', () => {
      expect(respondToIntroInput.safeParse({ introRequestId }).success).toBe(false);
    });

    it('refuses a via decision submitted as a target answer', () => {
      // ⚠ `pass_on` is the via's word and there is no statement that implements it for a
      // target. Accepting it here would take a request the server can only refuse, and
      // would do it *after* the caller believed they had done something.
      expect(
        respondToIntroInput.safeParse({ introRequestId, response: INTRO_DECISION.passOn }).success,
      ).toBe(false);
    });

    it('refuses an id that is not a uuid', () => {
      expect(
        respondToIntroInput.safeParse({ introRequestId: 'not-a-uuid', response: 'accept' }).success,
      ).toBe(false);
    });
  });

  describe('what it will not take', () => {
    it('refuses a note rather than stripping one', () => {
      // ⚠ **Refused, not dropped**, for `decide-intro.input.ts`'s reason one person along.
      // An acceptance says nothing beyond itself and a decline is never shown to anybody,
      // so there is no reader for text sent here — and zod's default object would have
      // stripped it in silence and let its writer believe otherwise.
      expect(
        respondToIntroInput.safeParse({
          introRequestId,
          response: 'decline',
          note: 'nothing personal',
        }).success,
      ).toBe(false);
    });

    it('refuses a status a caller tried to name for themselves', () => {
      // A caller says what they are *doing*; the server decides what that stores. A
      // `status` field would let somebody post their own outcome onto somebody else's row.
      expect(
        respondToIntroInput.safeParse({
          introRequestId,
          response: 'accept',
          status: INTRO_REQUEST_STATUS.accepted,
        }).success,
      ).toBe(false);
    });

    it('refuses every spelling of an actor identifier (ADR-0002:180-181, B14)', () => {
      // The target is the resolved actor, compared against the row's stored `target_id`
      // inside the update. A field here would be the one place somebody could answer an
      // introduction that is not theirs.
      for (const field of ['viewerId', 'userId', 'actorId', 'ownerId', 'targetUserId']) {
        expect(
          respondToIntroInput.safeParse({
            introRequestId,
            response: 'accept',
            [field]: '22222222-2222-4222-8222-222222222222',
          }).success,
          `${field} must not be accepted`,
        ).toBe(false);
      }
    });
  });

  describe('respondToIntroCommandFields', () => {
    it('maps the parsed input onto the command, and names no actor', () => {
      const fields = respondToIntroCommandFields(
        respondToIntroInput.parse({ introRequestId, response: 'accept' }),
      );

      expect(fields).toEqual({ introRequestId, response: 'accept' });
      // `actorId` is the resolved actor and is never derivable from input — the router
      // supplies it, and this mapping has nowhere to put one even by accident.
      expect(Object.keys(fields)).not.toContain('actorId');
    });
  });
});

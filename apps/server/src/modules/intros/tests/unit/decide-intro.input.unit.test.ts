import { describe, expect, it } from 'vitest';

import { INTRO_DECISION } from '../../domain/intro-request';
import {
  decideIntroCommandFields,
  decideIntroInput,
} from '../../transport/decide-intro.input';

/**
 * `specs/features/request-an-intro.feature` › "Passing an intro on requires a note of the
 * via's own" and › "A decline carries no note" — the wire half (`@unit`, issue #175).
 *
 * The schema is a **discriminated union**, so the shape of the request depends on the
 * decision in it: `pass_on` takes the via's note, `decline` takes none. Everything below
 * is about that dependency actually being enforced rather than merely documented — a
 * single object with an optional `note` would type-check every one of these and refuse
 * none of them.
 *
 * ⚠ The bound is deliberately **not** restated here beyond "at least one character".
 * `domain/intro-note.policy.ts` owns 1–4000, so an over-long note comes back as the
 * stable `INTRO_CONTENT_INVALID` rather than a generic `BAD_REQUEST` — the same split
 * `request-intro.input.ts` makes.
 */
describe('decideIntroInput', () => {
  const introRequestId = '11111111-1111-4111-8111-111111111111';

  describe('passing it on', () => {
    it('accepts the decision and the via’s note together', () => {
      const parsed = decideIntroInput.parse({
        introRequestId,
        decision: INTRO_DECISION.passOn,
        note: 'They should meet at the tea camp.',
      });

      expect(parsed).toEqual({
        introRequestId,
        decision: INTRO_DECISION.passOn,
        note: 'They should meet at the tea camp.',
      });
    });

    it('refuses a pass-on with no note at all', () => {
      // ⚠ The requirement lives on the wire *and* in the domain, and neither is
      // redundant: this one is what makes the shape unrepresentable to a typed client,
      // and the domain's is what holds for every caller TypeScript never saw.
      expect(
        decideIntroInput.safeParse({ introRequestId, decision: INTRO_DECISION.passOn }).success,
      ).toBe(false);
    });

    it('refuses an empty note here rather than passing it through', () => {
      // `min(1)` is about the union being honest — a branch that says "this one has a
      // note" must not accept a request with no note in it. Whitespace-only is the
      // domain's to refuse, because trimming is its rule and not the wire's.
      expect(
        decideIntroInput.safeParse({
          introRequestId,
          decision: INTRO_DECISION.passOn,
          note: '',
        }).success,
      ).toBe(false);
    });

    it('leaves a whitespace-only note to the domain, untrimmed', () => {
      const parsed = decideIntroInput.parse({
        introRequestId,
        decision: INTRO_DECISION.passOn,
        note: '   ',
      });

      // Untouched: the trim is `validateViaNote`'s, and a schema that trimmed here would
      // be a second copy of a rule whose refusal code lives somewhere else.
      expect(parsed).toMatchObject({ note: '   ' });
    });
  });

  describe('declining', () => {
    it('accepts the decision alone', () => {
      expect(
        decideIntroInput.parse({ introRequestId, decision: INTRO_DECISION.decline }),
      ).toEqual({ introRequestId, decision: INTRO_DECISION.decline });
    });

    it('refuses a note rather than stripping one', () => {
      // ⚠ The whole reason this branch is a `strictObject`. Zod's default object drops
      // unknown keys silently, so a client attaching a reason to a decline would get a
      // success back for a note nobody will ever read — and would have no way to find
      // out. The refusal is the only honest answer.
      const outcome = decideIntroInput.safeParse({
        introRequestId,
        decision: INTRO_DECISION.decline,
        note: 'Not for you, sorry.',
      });

      expect(outcome.success).toBe(false);
    });
  });

  it('refuses a decision outside the two the via may make', () => {
    // A closed wire vocabulary, derived from the domain constant — so `requested` is not
    // a decision a caller can post, and un-deciding somebody else's answer has no shape.
    expect(
      decideIntroInput.safeParse({ introRequestId, decision: 'requested', note: 'x' }).success,
    ).toBe(false);
  });

  it('accepts no identifier naming the caller, on either branch (ADR-0002 §5a)', () => {
    // The walker in `tests/fitness/viewer-id-provenance.fitness.test.ts` proves this over
    // the built router; this is the same claim at the branch level, where a union makes
    // it possible to add a field to one arm and not notice it in the other.
    for (const field of ['viewerId', 'userId', 'actorId', 'ownerId']) {
      expect(
        decideIntroInput.safeParse({
          introRequestId,
          decision: INTRO_DECISION.decline,
          [field]: '22222222-2222-4222-8222-222222222222',
        }).success,
        `${field} must not be accepted on a decline`,
      ).toBe(false);
    }
  });
});

describe('decideIntroCommandFields', () => {
  const introRequestId = '11111111-1111-4111-8111-111111111111';

  it('renames the wire’s note to the command’s viaNote', () => {
    // Two names for one thing, on purpose: `note` is what the via typed, `viaNote` is
    // what distinguishes it from the requester's on a row that carries both.
    const fields = decideIntroCommandFields(
      decideIntroInput.parse({
        introRequestId,
        decision: INTRO_DECISION.passOn,
        note: 'They should meet at the tea camp.',
      }),
    );

    expect(fields).toEqual({
      introRequestId,
      decision: INTRO_DECISION.passOn,
      viaNote: 'They should meet at the tea camp.',
    });
  });

  it('omits the key entirely on a decline, rather than sending undefined', () => {
    const fields = decideIntroCommandFields(
      decideIntroInput.parse({ introRequestId, decision: INTRO_DECISION.decline }),
    );

    // `in`, not a truthiness check: "the key is absent" and "the key holds undefined" are
    // different claims, and only the first one keeps `exactOptionalPropertyTypes` and the
    // table's null column telling the same story.
    expect('viaNote' in fields).toBe(false);
    expect(fields).toEqual({ introRequestId, decision: INTRO_DECISION.decline });
  });

  it('carries no actorId — the via is the resolved actor and never an input', () => {
    const fields = decideIntroCommandFields(
      decideIntroInput.parse({ introRequestId, decision: INTRO_DECISION.decline }),
    );

    expect(Object.keys(fields)).not.toContain('actorId');
  });
});

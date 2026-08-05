import { describe, expect, it } from 'vitest';

import { validateHandle } from '../../domain/handle.policy';
import {
  HandleInvalidCharsetError,
  HandleReservedError,
  HandleTooLongError,
} from '../../domain/user.errors';

/**
 * `specs/features/identity-magic-link.feature` — the three `@unit` handle scenarios.
 *
 * ADR-0008:50-57 lists five handle rules; two of them (`citext` case-collision and
 * confusable-normalization) need a database lookup against existing handles and are
 * therefore `@integration` (`tests/integration/handle-uniqueness.integration.test.ts`).
 * The three here — reserved-word blocklist, charset, length — are syntactic checks on
 * the submitted string alone, which is what makes `handle.policy.ts` pure logic with
 * no I/O (lane brief L1, "Module layout").
 *
 * M2-AC25 (implementation-plan.md:394-397): "Onboarding rejects, each with a
 * structured code naming the rule: a reserved handle (`admin`), a duplicate differing
 * only by case (citext), a confusable of an existing handle, an out-of-charset
 * handle, and an over-length handle. A change attempt returns `HANDLE_IMMUTABLE`.
 * Evidence: six quoted error responses." The lane brief further glosses this as "six
 * structured codes" (m2-lane-briefs.md:362) — this suite and its integration sibling
 * together assert six distinct `ApplicationError.code` values, one per scenario.
 */
describe('validateHandle (ADR-0008:50-57, M2-AC25)', () => {
  describe('given the handle "admin" is on the reserved-word blocklist', () => {
    describe('when onboarding submits handle "admin"', () => {
      it('rejects with a structured error naming the reserved-word rule', () => {
        expect(() => validateHandle('admin')).toThrow(HandleReservedError);
      });

      it('carries the stable code HANDLE_RESERVED', () => {
        expect.assertions(1);
        try {
          validateHandle('admin');
        } catch (error) {
          expect((error as HandleReservedError).code).toBe('HANDLE_RESERVED');
        }
      });
    });
  });

  describe('given a handle containing characters outside [a-z0-9_]', () => {
    const outOfCharsetHandle = 'dusty!rhodes';

    describe('when onboarding submits that handle', () => {
      it('rejects with a structured error naming the charset rule', () => {
        expect(() => validateHandle(outOfCharsetHandle)).toThrow(HandleInvalidCharsetError);
      });

      it('carries the stable code HANDLE_INVALID_CHARSET', () => {
        expect.assertions(1);
        try {
          validateHandle(outOfCharsetHandle);
        } catch (error) {
          expect((error as HandleInvalidCharsetError).code).toBe('HANDLE_INVALID_CHARSET');
        }
      });
    });
  });

  describe('given a handle longer than 24 characters', () => {
    const overLengthHandle = 'a'.repeat(25);

    describe('when onboarding submits that handle', () => {
      it('rejects with a structured error naming the length rule', () => {
        expect(() => validateHandle(overLengthHandle)).toThrow(HandleTooLongError);
      });

      it('carries the stable code HANDLE_TOO_LONG', () => {
        expect.assertions(1);
        try {
          validateHandle(overLengthHandle);
        } catch (error) {
          expect((error as HandleTooLongError).code).toBe('HANDLE_TOO_LONG');
        }
      });
    });
  });

  describe('a handle satisfying every syntactic rule', () => {
    it('is accepted — mixed case is not a charset violation, only a citext concern for the integration suite', () => {
      // "DustStorm" must pass this pure check: the case-collision scenario
      // (tests/integration/handle-uniqueness.integration.test.ts) submits exactly
      // this shape and expects it to fail on citext uniqueness, not on charset.
      // ADR-0008:54 states the charset regex as lowercase-only ([a-z0-9_]{3,24}),
      // which would reject "DustStorm" here and make that integration scenario
      // unreachable — so this pure check is necessarily case-insensitive on
      // character class, leaving case-collision detection entirely to the
      // database-backed citext check. Flagged as a resolved ambiguity; see the
      // handoff report.
      expect(() => validateHandle('DustStorm')).not.toThrow();
    });
  });
});

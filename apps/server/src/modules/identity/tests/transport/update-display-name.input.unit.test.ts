import { describe, expect, it } from 'vitest';

import { completeOnboardingInput } from '../../transport/complete-onboarding.input';
import { DISPLAY_NAME_MAX_LENGTH } from '../../transport/display-name';
import { updateDisplayNameInput } from '../../transport/update-display-name.input';

/**
 * `specs/features/edit-display-name.feature` — the `@unit` scenarios about what the
 * wire accepts.
 *
 * The bounds are asserted **against onboarding's schema as well as their own**, not
 * restated as literals: decision D15's whole claim is that the edit accepts exactly
 * what creation accepts, and a test carrying its own copy of `80` would keep passing
 * on the day the two schemas diverge — which is the only failure this file exists to
 * catch.
 */

/** The same handle for every onboarding probe; only the name is under test. */
const HANDLE = 'dusty_rhodes';

function onboardingAccepts(displayName: string): boolean {
  return completeOnboardingInput.safeParse({ handle: HANDLE, displayName }).success;
}

function editAccepts(displayName: string): boolean {
  return updateDisplayNameInput.safeParse({ displayName }).success;
}

describe('updateDisplayNameInput (issue #177, decision D15)', () => {
  describe('The edit accepts exactly what onboarding accepts', () => {
    it.each([
      ['an ordinary name', 'Dusty Rhodes'],
      ['a single character', 'D'],
      ['the longest permitted name', 'n'.repeat(DISPLAY_NAME_MAX_LENGTH)],
      ['one character too long', 'n'.repeat(DISPLAY_NAME_MAX_LENGTH + 1)],
      ['the empty string', ''],
      ['whitespace only', '   '],
      ['a name padded with whitespace', '  Dusty  '],
      ['a name of non-Latin characters', 'Пыльная Буря'],
      ['an emoji', '🌵'],
    ])('agrees with onboarding about %s', (_case, displayName) => {
      expect(editAccepts(displayName)).toBe(onboardingAccepts(displayName));
    });
  });

  describe('A name that is only whitespace is refused', () => {
    it.each([
      ['the empty string', ''],
      ['three spaces', '   '],
      ['a tab and a newline', '\t\n'],
    ])('refuses %s — trimming happens before the length check', (_case, displayName) => {
      expect(editAccepts(displayName)).toBe(false);
    });
  });

  describe('A name longer than the bound is refused', () => {
    it('accepts exactly DISPLAY_NAME_MAX_LENGTH characters and refuses one more', () => {
      expect(editAccepts('n'.repeat(DISPLAY_NAME_MAX_LENGTH))).toBe(true);
      expect(editAccepts('n'.repeat(DISPLAY_NAME_MAX_LENGTH + 1))).toBe(false);
    });

    it('measures the name after trimming, so surrounding space cannot push it over', () => {
      const atTheBound = 'n'.repeat(DISPLAY_NAME_MAX_LENGTH);

      expect(updateDisplayNameInput.parse({ displayName: `  ${atTheBound}  ` })).toEqual({
        displayName: atTheBound,
      });
    });
  });

  describe('A display name is trimmed before it is stored', () => {
    it('parses to the trimmed name, so the stored value carries no padding', () => {
      expect(updateDisplayNameInput.parse({ displayName: '  Dusty Rhodes  ' })).toEqual({
        displayName: 'Dusty Rhodes',
      });
    });
  });

  describe('The input carries nothing but the name', () => {
    // `tests/fitness/viewer-id-provenance.fitness.test.ts` walks the whole router for
    // the identifier half, which is the load-bearing check. Asserted here as well
    // because this is the schema a future edit would widen, and the failure then reads
    // as "the rename schema grew a field" rather than "some procedure somewhere did".
    it.each(['userId', 'viewerId', 'actorId', 'ownerId'])(
      'refuses a supplied %s rather than silently dropping it',
      (field) => {
        expect(
          updateDisplayNameInput.safeParse({ displayName: 'Dust Storm', [field]: 'app-user-2' })
            .success,
        ).toBe(false);
      },
    );

    it('refuses a supplied handle — the refusal is audible, per ADR-0008 rule 4 and D15', () => {
      // The one a person might genuinely try, having read that handles exist. Stripping
      // it would answer `200` to somebody who believes they have just changed their
      // handle, which is `decide-intro.input.ts`'s hazard on a field that guards
      // against impersonation.
      expect(
        updateDisplayNameInput.safeParse({ displayName: 'Dust Storm', handle: 'newhandle' })
          .success,
      ).toBe(false);
    });

    it('accepts the name on its own', () => {
      expect(updateDisplayNameInput.parse({ displayName: 'Dust Storm' })).toEqual({
        displayName: 'Dust Storm',
      });
    });
  });
});

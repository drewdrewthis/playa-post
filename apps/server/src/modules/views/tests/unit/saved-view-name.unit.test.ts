import { describe, expect, it } from 'vitest';

import { SAVED_VIEW_NAME_MAX_LENGTH } from '../../domain/saved-view';
import { validateSavedViewName } from '../../domain/saved-view-name.policy';
import { SavedViewNameInvalidError } from '../../domain/saved-view.errors';

describe('validateSavedViewName (issue #45)', () => {
  it('trims, and returns the trimmed value the caller must store', () => {
    expect(validateSavedViewName('  Rides to BRC  ')).toBe('Rides to BRC');
  });

  it('refuses a name that is only whitespace — a card whose name renders blank is a row nobody can tell apart', () => {
    expect(() => validateSavedViewName('   ')).toThrow(SavedViewNameInvalidError);
  });

  it('refuses an empty name', () => {
    expect(() => validateSavedViewName('')).toThrow(SavedViewNameInvalidError);
  });

  it(`accepts exactly ${String(SAVED_VIEW_NAME_MAX_LENGTH)} characters and refuses one more`, () => {
    const atLimit = 'x'.repeat(SAVED_VIEW_NAME_MAX_LENGTH);

    expect(validateSavedViewName(atLimit)).toBe(atLimit);
    expect(() => validateSavedViewName(`${atLimit}x`)).toThrow(SavedViewNameInvalidError);
  });

  it('measures the bound after trimming, so surrounding whitespace cannot spend the budget', () => {
    const atLimit = 'x'.repeat(SAVED_VIEW_NAME_MAX_LENGTH);

    expect(validateSavedViewName(`  ${atLimit}  `)).toBe(atLimit);
  });

  it('names the bound without echoing the input — a message carrying user text is one log line from a leak', () => {
    const rejection = (): unknown => {
      try {
        validateSavedViewName('kitchen crew for tuesday '.repeat(20));
      } catch (error) {
        return error;
      }
      return undefined;
    };

    const error = rejection();
    expect(error).toBeInstanceOf(SavedViewNameInvalidError);
    expect((error as Error).message).not.toMatch(/kitchen/);
    expect((error as Error).message).toMatch(String(SAVED_VIEW_NAME_MAX_LENGTH));
  });
});

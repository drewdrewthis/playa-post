import { SAVED_VIEW_NAME_MAX_LENGTH } from './saved-view';
import { SavedViewNameInvalidError } from './saved-view.errors';

/**
 * Accept a submitted view name, or refuse it.
 *
 * Trimmed first, so leading whitespace can neither disguise an empty name nor consume
 * the length budget — the identical rule `validateBulletinContent` applies to a title,
 * and for the identical reason: a card whose name renders as blank space is a row nobody
 * can tell apart from the one above it.
 *
 * @returns The trimmed name, which is what gets stored — the caller must use this return
 *   value rather than its own input, or the trim is advice instead of a rule.
 * @throws {SavedViewNameInvalidError} naming the bound, never echoing the input.
 */
export function validateSavedViewName(name: string): string {
  const trimmed = name.trim();

  if (trimmed.length === 0 || trimmed.length > SAVED_VIEW_NAME_MAX_LENGTH) {
    throw new SavedViewNameInvalidError();
  }

  return trimmed;
}

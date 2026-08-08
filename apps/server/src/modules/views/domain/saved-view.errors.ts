import { ApplicationError } from '../../../shared/errors/application-error';

import { SAVED_VIEW_LIMIT_PER_OWNER, SAVED_VIEW_NAME_MAX_LENGTH } from './saved-view';

/**
 * The name you gave a view is not one this product will store.
 *
 * Names the bound rather than echoing the input: the caller sent the string, so quoting
 * it back discloses nothing — but a message carrying arbitrary user text is one log line
 * away from being the leak `modules/bulletins` refuses for the same reason
 * (`BulletinContentInvalidError` takes a field and a limit, never the value).
 */
export class SavedViewNameInvalidError extends ApplicationError {
  static readonly code = 'SAVED_VIEW_NAME_INVALID';

  constructor() {
    super(
      SavedViewNameInvalidError.code,
      `A view's name must not be empty and may be at most ${String(SAVED_VIEW_NAME_MAX_LENGTH)} characters.`,
    );
    this.name = 'SavedViewNameInvalidError';
  }
}

/**
 * There is no such view **for you**.
 *
 * ⚠ **The one error for "it never existed" and "it is somebody else's", and it must stay
 * that way.** M5-AC16 is explicit that user B cannot read, update, or delete user A's
 * view by ID and gets a *404, not a 403* — a 403 would confirm that the identifier names
 * a real view belonging to someone, which is a membership oracle over a table whose rows
 * describe what people are interested in. It is the identical decision
 * `BulletinGoneError` and `NotificationUnavailableError` already record.
 *
 * It carries no owner, no name, and no identifier beyond what the caller already sent.
 */
export class SavedViewUnavailableError extends ApplicationError {
  static readonly code = 'SAVED_VIEW_UNAVAILABLE';

  constructor() {
    super(SavedViewUnavailableError.code, 'That saved view is no longer available.');
    this.name = 'SavedViewUnavailableError';
  }
}

/**
 * The view you were renaming is not the one that is stored.
 *
 * ADR-0005:102 — `view.save` is `expectedVersion: yes`, so a version mismatch is a
 * **conflict** rather than a merge or a last-write-wins overwrite.
 *
 * ⚠ **It carries no `currentVersion` and no `currentState`, and must never grow
 * either** — the same rule {@link import('./notify-me-query.errors').NotifyMeQueryConflictError}
 * states, and for the same reason: every write against this table is scoped
 * `WHERE owner_id = <actor>`, so an actor naming somebody else's view mismatches their
 * *own* absent row. A `currentState` on this error would hand back the state that
 * scoping exists to protect.
 */
export class SavedViewConflictError extends ApplicationError {
  static readonly code = 'SAVED_VIEW_CONFLICT';

  constructor() {
    super(
      SavedViewConflictError.code,
      'That saved view has changed since you loaded it.',
    );
    this.name = 'SavedViewConflictError';
  }
}

/** You already keep as many views as this product stores. See {@link SAVED_VIEW_LIMIT_PER_OWNER}. */
export class SavedViewLimitReachedError extends ApplicationError {
  static readonly code = 'SAVED_VIEW_LIMIT_REACHED';

  constructor() {
    super(
      SavedViewLimitReachedError.code,
      `You can keep up to ${String(SAVED_VIEW_LIMIT_PER_OWNER)} saved views. Delete one to save another.`,
    );
    this.name = 'SavedViewLimitReachedError';
  }
}

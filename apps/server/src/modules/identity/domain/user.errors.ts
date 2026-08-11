import { ApplicationError } from '../../../shared/errors/application-error';

import { HANDLE_MAX_LENGTH, HANDLE_MIN_LENGTH } from './handle';

/**
 * The one thing a caller is told when a handle is already spoken for.
 *
 * Escalation E5: there is no handle-availability endpoint, because an availability
 * check is a people-existence oracle in a product whose PDF §4 promises no people
 * search. Submitting a taken handle is the only way to learn it is taken, and the
 * answer must not distinguish *how* it is taken — a case collision and a confusable
 * collision say exactly this, byte for byte, the same way the auth boundary answers
 * "no token" and "bad token" identically (ADR-0002 §10).
 *
 * The stable `code` still differs between the two, so the server's own logs and
 * M2-AC25's six-code evidence can tell them apart. A code is a machine-readable
 * classification for the *system*; the message is what the user sees.
 */
export const HANDLE_NOT_AVAILABLE_MESSAGE = 'That handle is not available. Choose another one.';

/**
 * The account vanished (erasure) between actor resolution and a write to its own row.
 *
 * ⚠ **Deliberately not an {@link ApplicationError}, unlike everything else in this
 * file.** `authenticatedProcedure` already guarantees an onboarded, active actor on
 * entry, so this is not a state a well-behaved client can reach; giving it a
 * client-facing code would publish a refusal nobody can act on and invite a client to
 * branch on it. It is a plain error the transport renders as a 500, which is the
 * honest status for "the row this request was resolved from is gone".
 *
 * Shared by every service that writes the caller's own `app.users` row — the
 * visibility dial and the display-name edit both reach it through the same race, and
 * a second copy of this class would be a second answer to one question.
 */
export class UserRowMissingError extends Error {
  constructor() {
    super('User row disappeared between actor resolution and the write to it.');
    this.name = 'UserRowMissingError';
  }
}

/** ADR-0008:54 — the handle is on the reserved-word blocklist. */
export class HandleReservedError extends ApplicationError {
  static readonly code = 'HANDLE_RESERVED';

  constructor() {
    super(HandleReservedError.code, 'That handle is reserved. Choose another one.');
    this.name = 'HandleReservedError';
  }
}

/** ADR-0008:54 — the handle contains characters outside `[a-z0-9_]`. */
export class HandleInvalidCharsetError extends ApplicationError {
  static readonly code = 'HANDLE_INVALID_CHARSET';

  constructor() {
    super(
      HandleInvalidCharsetError.code,
      'A handle may contain only lowercase letters, digits, and underscores.',
    );
    this.name = 'HandleInvalidCharsetError';
  }
}

/** ADR-0008:54 — the handle is longer than {@link HANDLE_MAX_LENGTH}. */
export class HandleTooLongError extends ApplicationError {
  static readonly code = 'HANDLE_TOO_LONG';

  constructor() {
    super(
      HandleTooLongError.code,
      `A handle may be at most ${String(HANDLE_MAX_LENGTH)} characters long.`,
    );
    this.name = 'HandleTooLongError';
  }
}

/**
 * ADR-0008:54 — the handle is shorter than {@link HANDLE_MIN_LENGTH}.
 *
 * The seventh code beside M2-AC25's six. `{3,24}` is one rule with two bounds, and
 * the AC quotes only the upper one because that is the scenario the feature file
 * names — but a two-character handle still has to be refused by something, and
 * folding it into `HANDLE_INVALID_CHARSET` would name the wrong rule in the one
 * field a client branches on.
 */
export class HandleTooShortError extends ApplicationError {
  static readonly code = 'HANDLE_TOO_SHORT';

  constructor() {
    super(
      HandleTooShortError.code,
      `A handle must be at least ${String(HANDLE_MIN_LENGTH)} characters long.`,
    );
    this.name = 'HandleTooShortError';
  }
}

/**
 * ADR-0008:54 — an existing handle differs from this one only by case.
 *
 * `citext` makes uniqueness case-insensitive in the database, so this is the rule the
 * column itself enforces; the check exists in the application so the refusal carries
 * a code instead of a constraint-violation stack.
 */
export class HandleCaseCollisionError extends ApplicationError {
  static readonly code = 'HANDLE_CASE_COLLISION';

  constructor() {
    super(HandleCaseCollisionError.code, HANDLE_NOT_AVAILABLE_MESSAGE);
    this.name = 'HandleCaseCollisionError';
  }
}

/** ADR-0008:56 — an existing handle reduces to the same confusable skeleton. */
export class HandleConfusableError extends ApplicationError {
  static readonly code = 'HANDLE_CONFUSABLE';

  constructor() {
    super(HandleConfusableError.code, HANDLE_NOT_AVAILABLE_MESSAGE);
    this.name = 'HandleConfusableError';
  }
}

/**
 * ADR-0008 rule 4 — a handle is chosen once and never changed in v1.
 *
 * Re-issuing a retired handle lets its new holder inherit shared links and real-world
 * recognition, which is an impersonation vector in a network built on recognition.
 * Operator-assisted change exists as a support path and tombstones the old handle;
 * this is the user-facing refusal.
 */
export class HandleImmutableError extends ApplicationError {
  static readonly code = 'HANDLE_IMMUTABLE';

  constructor() {
    super(
      HandleImmutableError.code,
      'Your handle was chosen when you joined and cannot be changed.',
    );
    this.name = 'HandleImmutableError';
  }
}

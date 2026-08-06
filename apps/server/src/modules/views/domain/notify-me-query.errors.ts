import { ApplicationError } from '../../../shared/errors/application-error';

/**
 * The saved query you were editing is not the one that is stored.
 *
 * ADR-0005:98 — `notifyMe.update` is `expectedVersion: yes`, so a version mismatch is
 * a **conflict** rather than a merge or a last-write-wins overwrite.
 *
 * ⚠ **It carries no `currentVersion` and no `currentState`, and must never grow
 * either.** ADR-0005 precedence rule 1 puts actorship before version comparison
 * precisely so that "the conflict envelope is a leak channel" stays closed, and this
 * table's shape makes an unrelated actor's attempt land here: a write is scoped
 * `WHERE owner_id = <actor>` unconditionally, so an actor supplying somebody else's
 * version mismatches their *own* absent row and is refused without a single column of
 * anybody else's query being read (M2-AC19). A `currentState` on this error would
 * hand that back for free, which is exactly what the assertion in
 * `notify-me-query.integration.test.ts` checks for.
 */
export class NotifyMeQueryConflictError extends ApplicationError {
  static readonly code = 'NOTIFY_ME_QUERY_CONFLICT';

  constructor() {
    super(
      NotifyMeQueryConflictError.code,
      'Your saved Notify Me query has changed since you loaded it.',
    );
    this.name = 'NotifyMeQueryConflictError';
  }
}

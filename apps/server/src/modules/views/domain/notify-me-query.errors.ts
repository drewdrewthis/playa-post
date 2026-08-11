import { ApplicationError } from '../../../shared/errors/application-error';

import { NOTIFY_ME_QUERY_LIMIT_PER_OWNER } from './notify-me-query';

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

/**
 * You already have as many notifications switched on as this product evaluates.
 *
 * ⚠ **It names the bound and the remedy, and echoes nothing.** The same rule
 * {@link import('./saved-view.errors').SavedViewLimitReachedError} follows: a message
 * carrying the query text somebody typed is one log line away from being a leak, and a
 * refusal that does not say what to do instead gets retried until it is reported as a bug.
 *
 * Reachable from both write paths onto `app.notify_me_queries`, because both can add a
 * row: lighting the bell on a view that has none, and `views.notifyMe.update` writing a
 * first untied query. Neither can reach it by *changing* a query that already exists —
 * an upsert onto a row this owner already holds does not grow the count.
 *
 * See {@link NOTIFY_ME_QUERY_LIMIT_PER_OWNER} for why the number is what it is.
 */
export class NotifyMeQueryLimitReachedError extends ApplicationError {
  static readonly code = 'NOTIFY_ME_QUERY_LIMIT_REACHED';

  constructor() {
    super(
      NotifyMeQueryLimitReachedError.code,
      `You can have notifications on for up to ${String(NOTIFY_ME_QUERY_LIMIT_PER_OWNER)} saved queries. Switch one off to add another.`,
    );
    this.name = 'NotifyMeQueryLimitReachedError';
  }
}

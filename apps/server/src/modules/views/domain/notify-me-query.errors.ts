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
 * You already have bells lit on as many saved views as this product evaluates.
 *
 * ⚠ **It names the bound and the remedy, and echoes nothing.** The same rule
 * {@link import('./saved-view.errors').SavedViewLimitReachedError} follows: a message
 * carrying the query text somebody typed is one log line away from being a leak, and a
 * refusal that does not say what to do instead gets retried until it is reported as a bug.
 *
 * ⚠ **It says "saved views" rather than "saved queries", and the difference is the
 * remedy's honesty.** The cap counts the *designated* queries — the bells on cards — and
 * not the untied query `views.notifyMe.update` writes, which the unique key already holds
 * at one per person. If the untied row counted, this message would tell somebody to switch
 * a bell off when the slot was being held by something no card can free.
 *
 * Raised only by `views.saved.setNotify`, and only for a bell that is not already lit:
 * re-lighting one is an upsert onto a row the owner already holds and grows no count.
 * `views.notifyMe.update` cannot reach it at all.
 *
 * See {@link NOTIFY_ME_QUERY_LIMIT_PER_OWNER} for why the number is what it is.
 */
export class NotifyMeQueryLimitReachedError extends ApplicationError {
  static readonly code = 'NOTIFY_ME_QUERY_LIMIT_REACHED';

  constructor() {
    super(
      NotifyMeQueryLimitReachedError.code,
      `You can have notifications on for up to ${String(NOTIFY_ME_QUERY_LIMIT_PER_OWNER)} saved views. Switch one off to add another.`,
    );
    this.name = 'NotifyMeQueryLimitReachedError';
  }
}

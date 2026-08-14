/**
 * `views.notifyMe.update` input.
 *
 * `expectedVersion` absent means "create or overwrite"; present means "only if the
 * saved query is still at this version". A mismatch is a `conflict`, never a
 * last-write-wins overwrite — the last saved query is user-visible state, not a merge
 * candidate (ADR-0005's conflict matrix).
 */
export interface UpdateNotifyMeQueryRequest {
  readonly sourceText: string;
  /**
   * `?: number | undefined`, not `?: number`. The server's schema marks it
   * `.optional()`, which accepts an explicitly-`undefined` value as well as an omitted
   * key; under `exactOptionalPropertyTypes` the narrower form would refuse a call the
   * server would have served.
   */
  readonly expectedVersion?: number | undefined;
}

/** `views.notifyMe.update` output — the saved query, as stored. */
export interface NotifyMeQuery {
  readonly sourceText: string;
  readonly version: number;
  readonly updatedAt: string;
}

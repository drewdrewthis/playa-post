import type { NotifyMeQuery } from '../domain/notify-me-query';

/**
 * A saved Notify Me query as this API renders one.
 *
 * `sourceText` round-trips back into the input exactly as the person typed it, which
 * is the whole reason ADR-0007 stores the text beside the AST. **The AST itself is not
 * on the wire**: it is an internal representation this module is free to change under
 * a new `ast_version`, and publishing it would make every future grammar change a
 * client-visible break for no benefit — the client already has the text it sent.
 *
 * `version` is here because the client must send it back as `expectedVersion` on the
 * next edit (ADR-0005:98). Timestamps are ISO-8601 strings rather than `Date`s, for
 * `bulletin.presenter.ts`'s reason: that is what a client actually receives.
 */
export interface PresentedNotifyMeQuery {
  readonly sourceText: string;
  readonly version: number;
  readonly updatedAt: string;
}

/** Project a saved query onto the wire. */
export function presentNotifyMeQuery(query: NotifyMeQuery): PresentedNotifyMeQuery {
  return {
    sourceText: query.sourceText,
    version: query.version,
    updatedAt: query.updatedAt.toISOString(),
  };
}

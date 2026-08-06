import type { HiddenBulletin } from '../domain/hidden-bulletin';

/**
 * What a report or a dismissal answers with: the bulletin it hid, and when.
 *
 * **Two fields, and the missing third is the point.** There is no `reporterId`, no
 * `reportCount`, no author, and no bulletin content — the response confirms a private
 * act to the person who performed it and discloses nothing else (M2-AC10/B9,
 * M2-AC11). `viewerId` is deliberately absent too: it can only ever be the caller, so
 * echoing it would be an identifier in a payload that no client needs and every log
 * would then carry.
 *
 * Timestamps are ISO-8601 strings rather than `Date`s. tRPC without a serializer turns
 * a `Date` into a string on the wire anyway, so declaring the string is declaring what
 * a client actually receives instead of a type that is true only in-process.
 */
export interface PresentedHiddenBulletin {
  readonly bulletinId: string;
  /** When it left this viewer's board. Unchanged by a repeated report or dismissal. */
  readonly hiddenAt: string;
}

/** Project the outcome of a report or a dismissal onto the wire. */
export function presentHiddenBulletin(hidden: HiddenBulletin): PresentedHiddenBulletin {
  return {
    bulletinId: hidden.bulletinId,
    hiddenAt: hidden.hiddenAt.toISOString(),
  };
}

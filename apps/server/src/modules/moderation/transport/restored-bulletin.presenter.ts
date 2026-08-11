import type { RestoredBulletin } from '../domain/restored-bulletin';

/**
 * What `moderation.undismiss` answers with: the bulletin it put back, and nothing else.
 *
 * **One field, and the missing second one is the point.** Its sibling
 * {@link import('./hidden-bulletin.presenter').PresentedHiddenBulletin} carries `hiddenAt`
 * because a hide is a stored fact with a moment; a restore deletes that fact, so there is
 * no moment left to report and a synthesized one would describe the server's clock rather
 * than anything a client could rely on.
 *
 * ⚠ `viewerId` is absent for the reason it is absent there: it can only ever be the caller,
 * so echoing it would put an identifier in a payload no client needs and every log would
 * then carry.
 */
export interface PresentedRestoredBulletin {
  readonly bulletinId: string;
}

/** Project the outcome of an un-dismissal onto the wire. */
export function presentRestoredBulletin(restored: RestoredBulletin): PresentedRestoredBulletin {
  return { bulletinId: restored.bulletinId };
}

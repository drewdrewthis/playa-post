import type { User } from '../domain/user';

/**
 * A user as this API renders one.
 *
 * `userId` is safe **as output**: a caller returning its own identifier is not the
 * hazard — a caller *supplying* one is (ADR-0002 §5a). The provenance fitness rule
 * checks inputs only, for exactly this reason.
 */
export interface PresentedUser {
  readonly userId: string;
  readonly handle: string;
  readonly displayName: string;
}

/**
 * Project a user for the person who **is** that user.
 *
 * ⚠ Not a general person projection. ADR-0002 §6a requires every representation of
 * *another* person to be projected through `app.visible_people`'s disclosure level,
 * and this function performs no such check — it exists for the one case where viewer
 * and subject are the same, which is the only case lane L1 has. A second caller
 * wanting to render somebody else needs L2's projection, not this.
 *
 * `status`, `avatarPath`, `version`, and the lifecycle timestamps are omitted: no
 * client needs them yet, and the smallest payload that answers the question is the
 * one that cannot leak the next field by accident.
 */
export function presentUser(user: User): PresentedUser {
  return {
    userId: user.id,
    handle: user.handle,
    displayName: user.displayName,
  };
}

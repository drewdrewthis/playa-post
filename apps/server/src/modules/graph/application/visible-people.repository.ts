import type { ViewerId } from '../../../shared/auth/viewer-id';

import type { VisiblePerson } from './visible-person';

/**
 * The port onto `app.visible_people`.
 *
 * Declared in `application/` rather than `domain/` because ADR-0004 decision 7 is
 * explicit that this is a **read model, not a domain entity**: the graph has no
 * aggregate to reconstruct, and inventing a `domain/` layer to hold a projection would
 * be the placeholder layer addendum §4 forbids. `modules/graph` therefore has no
 * domain directory, and that is a statement about the module rather than an omission.
 */
export interface VisiblePeopleRepository {
  /**
   * Every person this viewer is authorized to see, already projected.
   *
   * @param viewerId - A {@link ViewerId}, never a `string`. ADR-0002 §5a: the
   *   catastrophic bug in this architecture is not a missing `WHERE`, it is a viewer
   *   identifier that arrived from request input, and the brand is what makes that
   *   unwritable rather than merely discouraged.
   * @returns Rows in ascending degree order, viewer first. Never empty for an active
   *   viewer: a person with no connections still sees themselves.
   */
  findVisiblePeople(viewerId: ViewerId): Promise<readonly VisiblePerson[]>;
}

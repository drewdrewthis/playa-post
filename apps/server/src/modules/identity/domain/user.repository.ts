import type { Handle } from './handle';
import type { User } from './user';
import type { VisibleToDistance } from './visible-to-distance';

/**
 * Everything needed to create one `app.users` row.
 *
 * `handle` is a {@link Handle}, not a `string`, so the only way to reach this type is
 * through `validateHandle`. That is the compiler enforcing ADR-0008:54 rather than a
 * reviewer remembering it.
 *
 * `createdAt` is supplied rather than defaulted because the column has no default
 * (ADR-0008:29) — the writer states when onboarding completed.
 */
export interface NewUser {
  readonly authUserId: string;
  readonly handle: Handle;
  readonly displayName: string;
  readonly createdAt: Date;
}

/**
 * The identity module's persistence port.
 *
 * Declared here in `domain/` and implemented in `persistence/`, per addendum §2:
 * infrastructure implements interfaces the domain defines, never the reverse. The
 * application layer depends on this interface and cannot see Kysely, `pg`, or SQL.
 *
 * Every lookup returns `null` rather than throwing on "no such row": absence is an
 * ordinary answer for all three of these questions, and the callers each turn it into
 * a different outcome.
 */
export interface UserRepository {
  /**
   * The product user behind a verified auth identity, if onboarding is complete.
   *
   * The one read on the authenticated request path (ADR-0008 rule 8) — indexed by the
   * `auth_user_id` unique constraint, paid once per request.
   */
  findByAuthUserId(authUserId: string): Promise<User | null>;

  /**
   * The user behind an internal `app.users.id` a layer above already resolved.
   *
   * Exists for reads that start from a verified actor rather than from a token —
   * the actor carries the internal id, and re-deriving it from `auth_user_id` would
   * pay ADR-0008 rule 8's one-hop cost a second time on the same request.
   */
  findById(userId: string): Promise<User | null>;

  /**
   * The holder of a handle, compared case-insensitively.
   *
   * `handle` is `citext`, so equality is already case-insensitive in the database and
   * this needs no `lower()`. That is the whole reason ADR-0008 chose the type.
   */
  findByHandle(handle: string): Promise<User | null>;

  /**
   * A user whose handle reduces to the same confusable skeleton (ADR-0008:56).
   *
   * @param skeleton - The candidate's skeleton, from
   *   {@link import('./handle').confusableSkeleton}. Compared against every existing
   *   handle's skeleton, computed in the database — the alternative, loading every
   *   handle into the process, is unbounded work on the onboarding path.
   */
  findByConfusableSkeleton(skeleton: string): Promise<User | null>;

  /**
   * Write a new user and return the stored row.
   *
   * @throws {import('./user.errors').HandleCaseCollisionError} if the handle was
   *   claimed between the availability check and this write.
   * @throws {import('./user.errors').HandleImmutableError} if this auth identity
   *   already has a user — the same race, on the other unique constraint.
   */
  add(user: NewUser): Promise<User>;

  /**
   * Store this user's own "who can see me at all" setting and return the stored row.
   *
   * Keyed on the internal `app.users.id` the caller already resolved from its verified
   * token — never on a client-supplied identifier (ADR-0002:180-181).
   *
   * Returns `null` if no such user exists, for the same reason the finders do: the
   * row can be erased between resolving the actor and this write, and that is an
   * ordinary answer rather than a 500.
   */
  setVisibleToDistance(userId: string, distance: VisibleToDistance): Promise<User | null>;

  /**
   * Store this user's own display name and return the stored row.
   *
   * Keyed on the internal `app.users.id` the caller already resolved from its verified
   * token — never on a client-supplied identifier (ADR-0002:180-181). There is no
   * parameter naming a subject, so this port cannot express renaming somebody else.
   *
   * ⚠ **Writes `display_name` and nothing else.** `handle` is immutable (ADR-0008
   * rule 4, decision D15), so a rename must leave it exactly where it was — every
   * reference by handle keeps resolving to the same person under a new name.
   *
   * Returns `null` if no such user exists, for the same reason the finders do: the
   * row can be erased between resolving the actor and this write, and that is an
   * ordinary answer rather than a 500.
   */
  setDisplayName(userId: string, displayName: string): Promise<User | null>;
}

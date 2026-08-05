import type { Handle } from './handle';
import type { User } from './user';

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
}

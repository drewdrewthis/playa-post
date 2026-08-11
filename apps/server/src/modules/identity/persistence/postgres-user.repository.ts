import { sql, type DatabaseConnection, type SqlBool } from '@playa-post/database';

import { confusableTranslationTable } from '../domain/handle';
import type { User } from '../domain/user';
import { HandleCaseCollisionError, HandleImmutableError } from '../domain/user.errors';
import type { NewUser, UserRepository } from '../domain/user.repository';
import type { VisibleToDistance } from '../domain/visible-to-distance';

import { toUser, type UserRow } from './user.mapper';

/** Everything the repository needs, injected (addendum §12). */
export interface PostgresUserRepositoryDependencies {
  /** Connected as `app_rw` and nothing else (ADR-0002 §2). */
  readonly database: DatabaseConnection;
}

/** PostgreSQL's `unique_violation`. */
const UNIQUE_VIOLATION = '23505';

/**
 * The fields `pg` puts on a `DatabaseError`, read structurally.
 *
 * Structural rather than `instanceof DatabaseError` so this file needs no value
 * import from the driver, and so it keeps working if the error travels through a
 * pool wrapper that copies the fields rather than the prototype.
 */
interface PostgresDriverError {
  readonly code?: unknown;
  readonly constraint?: unknown;
}

function violatedConstraint(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  const { code, constraint } = error as PostgresDriverError;
  return code === UNIQUE_VIOLATION && typeof constraint === 'string' ? constraint : undefined;
}

/**
 * `app.users`, behind the domain's {@link UserRepository} port.
 *
 * **The only file in this module allowed to contain SQL** — the
 * `no-sql-outside-persistence` fitness rule (`tests/fitness/`) fails the build on a
 * SQL literal or a `sql` tag anywhere else under `apps/server/src`.
 *
 * Every statement here is schema-qualified (`app.users`, never `users`) per
 * ADR-0002's pooler-safety rules: with `search_path` outside this file's control, an
 * unqualified name is a silent cross-schema read waiting for a `public.users` to
 * exist.
 */
export function createPostgresUserRepository(
  dependencies: PostgresUserRepositoryDependencies,
): UserRepository {
  const { database } = dependencies;

  /** One row or none, mapped. Every finder answers absence with `null`. */
  const firstOrNull = (row: UserRow | undefined): User | null =>
    row === undefined ? null : toUser(row);

  return {
    async findByAuthUserId(authUserId: string): Promise<User | null> {
      return firstOrNull(
        await database
          .selectFrom('app.users')
          .selectAll()
          .where('auth_user_id', '=', authUserId)
          .executeTakeFirst(),
      );
    },

    async findById(userId: string): Promise<User | null> {
      return firstOrNull(
        await database
          .selectFrom('app.users')
          .selectAll()
          .where('id', '=', userId)
          .executeTakeFirst(),
      );
    },

    async findByHandle(handle: string): Promise<User | null> {
      // No `lower()` and no functional index: `handle` is `citext`, so `=` is already
      // case-insensitive and uses the unique index directly (ADR-0008:53). The bound
      // parameter is sent untyped, which lets PostgreSQL resolve it *to* citext —
      // declaring it `text` instead would silently make this comparison
      // case-sensitive and quietly disable the case-collision rule.
      return firstOrNull(
        await database
          .selectFrom('app.users')
          .selectAll()
          .where('handle', '=', handle)
          .executeTakeFirst(),
      );
    },

    async findByConfusableSkeleton(skeleton: string): Promise<User | null> {
      // The substitution table is compiled from `domain/handle.ts` rather than
      // written out here, so there is exactly one definition of "confusable" and a
      // new entry cannot land in the domain while the database keeps comparing the
      // old set.
      const { from, to } = confusableTranslationTable();

      return firstOrNull(
        await database
          .selectFrom('app.users')
          .selectAll()
          .where(
            sql<SqlBool>`translate(lower(${sql.ref('handle')}::text), ${from}, ${to}) = ${skeleton}`,
          )
          .executeTakeFirst(),
      );
    },

    async add(user: NewUser): Promise<User> {
      try {
        return toUser(
          await database
            .insertInto('app.users')
            .values({
              auth_user_id: user.authUserId,
              handle: user.handle,
              display_name: user.displayName,
              created_at: user.createdAt,
            })
            .returningAll()
            .executeTakeFirstOrThrow(),
        );
      } catch (error) {
        // The service checks availability and then writes, and those are two
        // statements: a concurrent onboarding can claim the handle in between. The
        // unique constraints are the real authority, so their violation is
        // translated into the same refusal the check would have produced rather than
        // escaping as a 500 with a constraint name in it (M2-AC18).
        const constraint = violatedConstraint(error);
        if (constraint === 'users_handle_key') {
          throw new HandleCaseCollisionError();
        }
        if (constraint === 'users_auth_user_id_key') {
          throw new HandleImmutableError();
        }
        throw error;
      }
    },

    async setVisibleToDistance(
      userId: string,
      distance: VisibleToDistance,
    ): Promise<User | null> {
      // `version` is deliberately not bumped and no expected version is required.
      // ADR-0005's optimistic concurrency exists to stop two writers clobbering each
      // other's *content*; this column is a single-writer preference whose only writer
      // is its owner, and last-write-wins is the behaviour a dial that cycles on tap
      // should have. A conflict error here would surface as "your privacy change was
      // rejected" for two taps of the user's own thumb.
      return firstOrNull(
        await database
          .updateTable('app.users')
          .set({ visible_to_distance: distance })
          .where('id', '=', userId)
          .returningAll()
          .executeTakeFirst(),
      );
    },

    async setDisplayName(userId: string, displayName: string): Promise<User | null> {
      // `version` is deliberately not bumped and no expected version is required, for
      // the same reason `setVisibleToDistance` above does not: ADR-0005's optimistic
      // concurrency guards *content* two people can both edit, and this column has a
      // single writer who is its owner. ADR-0005's matrix has no row for a rename, and
      // a conflict error here would mean "your own name change was rejected because
      // your other device also changed it" — last-write-wins is what a person editing
      // their own name expects.
      //
      // ⚠ **`display_name` is the only column in the SET clause.** `handle` stays put
      // (ADR-0008 rule 4, decision D15), so every reference by handle survives a
      // rename; widening this statement is how handle editing would arrive by
      // accident rather than by amending that ADR.
      return firstOrNull(
        await database
          .updateTable('app.users')
          .set({ display_name: displayName })
          .where('id', '=', userId)
          .returningAll()
          .executeTakeFirst(),
      );
    },
  };
}

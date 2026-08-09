import type { User } from '../domain/user';
import type { UserRepository } from '../domain/user.repository';
import type { VisibleToDistance } from '../domain/visible-to-distance';

/** Collaborators, injected rather than resolved (addendum §12, ADR-0003). */
export interface VisibilitySettingDependencies {
  readonly users: UserRepository;
}

/**
 * Read and write the caller's own "who can see me at all" setting.
 *
 * `userId` is the internal `app.users.id` the transport resolved from the verified
 * token via `authenticatedProcedure` — never a caller-supplied field (ADR-0002:180-181).
 * There is deliberately no way to address anybody else's setting through this service.
 */
export interface VisibilitySettingService {
  /** The caller's current setting. */
  get(userId: string): Promise<VisibleToDistance>;
  /** Store the caller's setting and return what was stored. */
  set(userId: string, distance: VisibleToDistance): Promise<VisibleToDistance>;
}

/**
 * Thrown only for the race where the account vanishes (erasure) between actor
 * resolution and this call. `authenticatedProcedure` already guarantees an onboarded,
 * active actor on entry, so this is not a state a well-behaved client can reach —
 * which is why it is a plain error the transport renders as a 500, not an
 * `ApplicationError` with a client-facing code.
 */
class UserRowMissingError extends Error {
  constructor() {
    super('User row disappeared between actor resolution and the visibility operation.');
    this.name = 'UserRowMissingError';
  }
}

export function createVisibilitySettingService(
  dependencies: VisibilitySettingDependencies,
): VisibilitySettingService {
  const requireUser = (user: User | null): User => {
    if (user === null) {
      throw new UserRowMissingError();
    }
    return user;
  };

  return {
    async get(userId: string): Promise<VisibleToDistance> {
      return requireUser(await dependencies.users.findById(userId)).visibleToDistance;
    },

    async set(userId: string, distance: VisibleToDistance): Promise<VisibleToDistance> {
      return requireUser(await dependencies.users.setVisibleToDistance(userId, distance))
        .visibleToDistance;
    },
  };
}

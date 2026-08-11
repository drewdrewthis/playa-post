import type { User } from '../domain/user';
import { UserRowMissingError } from '../domain/user.errors';
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

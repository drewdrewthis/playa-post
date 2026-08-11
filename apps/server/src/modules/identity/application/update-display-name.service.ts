import { UserRowMissingError } from '../domain/user.errors';
import type { UserRepository } from '../domain/user.repository';

/** Collaborators, injected rather than resolved (addendum §12, ADR-0003). */
export interface UpdateDisplayNameDependencies {
  readonly users: UserRepository;
}

/**
 * Change the caller's own display name.
 *
 * `userId` is the internal `app.users.id` the transport resolved from the verified
 * token via `authenticatedProcedure` — never a caller-supplied field
 * (ADR-0002:180-181). There is deliberately no way to address anybody else's name
 * through this service: the parameter list has one identifier and the caller does not
 * choose it.
 */
export interface UpdateDisplayNameService {
  /** Store the caller's display name and return what was stored. */
  update(userId: string, displayName: string): Promise<string>;
}

/**
 * The rename use case (issue #177).
 *
 * **One write and no read-then-write.** The name has no invariant that depends on
 * what it was before — no uniqueness, no reserved list, no confusable rule — so there
 * is nothing to check that a `WHERE id = …` does not already decide. That is the
 * whole difference between this and `complete-onboarding.service.ts`, whose four
 * ordered rules exist because a *handle* is a public identifier other people
 * recognise.
 *
 * **The handle is untouched, and that is load-bearing rather than incidental.**
 * ADR-0008 rule 4 makes it immutable as an anti-impersonation measure, and decision
 * D15 records that #177 does not reopen it. Nothing in this file names the column, and
 * the repository method it calls cannot write it.
 *
 * **No outbox event** (decision D15). Every rendering of a person's name is projected
 * from `app.users.display_name` at read time through `app.visible_people`'s disclosure
 * gate (ADR-0002 §6a), so there is no derived copy anywhere for an event to go and
 * correct — and `UserOnboarded` already refuses to carry a display name into
 * `app.outbox_events` on the grounds that a durable, widely-read log is the wrong home
 * for personal data. An event whose entire payload was the new name would durably
 * record every name a person has ever gone by, which is exactly what that rule exists
 * to prevent.
 *
 * @throws {UserRowMissingError} if the account was erased between actor resolution
 *   and this write.
 */
export function createUpdateDisplayNameService(
  dependencies: UpdateDisplayNameDependencies,
): UpdateDisplayNameService {
  return {
    async update(userId: string, displayName: string): Promise<string> {
      const user = await dependencies.users.setDisplayName(userId, displayName);

      if (user === null) {
        throw new UserRowMissingError();
      }

      // The stored row's value, not the argument: what the caller is told is what the
      // database now holds, so a client that echoes it into its cache cannot diverge
      // from the server on a race between two edits.
      return user.displayName;
    },
  };
}

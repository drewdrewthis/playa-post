import { confusableSkeleton } from '../domain/handle';
import { validateHandle } from '../domain/handle.policy';
import type { User } from '../domain/user';
import {
  HandleCaseCollisionError,
  HandleConfusableError,
  HandleImmutableError,
} from '../domain/user.errors';
import { userOnboarded, type UserOnboarded } from '../domain/user.events';
import type { UserRepository } from '../domain/user.repository';

/**
 * What onboarding is given.
 *
 * `authUserId` comes from the verified token at the tRPC context boundary and is
 * **never** a field on a procedure input (ADR-0002:180-181). The transport reads it
 * off the request context; nothing a caller sends can set it.
 */
export interface CompleteOnboardingCommand {
  readonly authUserId: string;
  /** Exactly as submitted. Normalisation is `validateHandle`'s job, not the caller's. */
  readonly handle: string;
  readonly displayName: string;
}

/** The stored user plus the event that says they exist now. */
export interface CompleteOnboardingResult {
  readonly user: User;
  readonly event: UserOnboarded;
}

export interface CompleteOnboardingService {
  complete(command: CompleteOnboardingCommand): Promise<CompleteOnboardingResult>;
}

/** Collaborators, injected rather than resolved (addendum §12, ADR-0003). */
export interface CompleteOnboardingDependencies {
  readonly users: UserRepository;
  /**
   * Reads the wall clock. Overridable so a test can pin `created_at` without a real
   * clock; defaults to the process clock.
   */
  readonly now?: (() => Date) | undefined;
}

/**
 * The onboarding use case: choose a handle, get an `app.users` row.
 *
 * **Rule order is the contract, not an implementation detail.**
 *
 * 1. *Syntactic rules* (`validateHandle`) — cheapest, and they need no I/O.
 * 2. *Immutability* — a caller who already onboarded is refused `HANDLE_IMMUTABLE`
 *    whatever they submitted. Checked before availability so an existing user probing
 *    other people's handles learns nothing from the answer.
 * 3. *Case collision*, then *confusable collision*, in that order. `DustStorm` against
 *    an existing `duststorm` collides on **both** — they share a skeleton — and the
 *    feature file calls that scenario a citext-uniqueness rejection, so the exact
 *    match has to be asked first.
 * 4. The write, which is the only authority: steps 3 and 4 are separated by a window
 *    in which someone else can claim the handle, so the repository turns the unique
 *    violation into the same errors rather than letting a 23505 escape as a 500.
 *
 * There is deliberately **no availability query** exposed anywhere (escalation E5).
 * Submitting is how you find out, and the two "taken" refusals are worded identically.
 */
export function createCompleteOnboardingService(
  dependencies: CompleteOnboardingDependencies,
): CompleteOnboardingService {
  const readClock = dependencies.now ?? ((): Date => new Date());

  return {
    async complete(command: CompleteOnboardingCommand): Promise<CompleteOnboardingResult> {
      const handle = validateHandle(command.handle);

      if ((await dependencies.users.findByAuthUserId(command.authUserId)) !== null) {
        throw new HandleImmutableError();
      }
      if ((await dependencies.users.findByHandle(handle)) !== null) {
        throw new HandleCaseCollisionError();
      }
      if ((await dependencies.users.findByConfusableSkeleton(confusableSkeleton(handle))) !== null) {
        throw new HandleConfusableError();
      }

      const user = await dependencies.users.add({
        authUserId: command.authUserId,
        handle,
        displayName: command.displayName,
        createdAt: readClock(),
      });

      return { user, event: userOnboarded(user) };
    },
  };
}

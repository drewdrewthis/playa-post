import type { PrivacyLimits } from '../domain/privacy-limits';
import {
  validatePrivacyLimits,
  type SubmittedPrivacyLimits,
} from '../domain/privacy-limits.policy';
import type { PrivacyLimitsRepository } from '../domain/privacy-limits.repository';

/**
 * What setting the limits is given.
 *
 * `actorId` comes from the resolved `Actor`, never the request body — there is no field
 * here naming whose limits these are, because the only answer is "the caller's"
 * (ADR-0002:180-181).
 */
export interface SetPrivacyLimitsCommand {
  readonly actorId: string;
  /** Unvalidated as it arrives; {@link validatePrivacyLimits} is the only way it reaches storage. */
  readonly limits: SubmittedPrivacyLimits;
}

export interface SetPrivacyLimitsService {
  set(command: SetPrivacyLimitsCommand): Promise<PrivacyLimits>;
}

/** Collaborators, injected rather than resolved (addendum §12, ADR-0003). */
export interface SetPrivacyLimitsDependencies {
  readonly limits: PrivacyLimitsRepository;
  /** Reads the wall clock. Overridable so a test can pin `updated_at`. */
  readonly now?: (() => Date) | undefined;
}

/**
 * The SetPrivacyLimits use case (You screen, issue #49).
 *
 * **Both limits are written together, always.** The screen presents four pickers and
 * this command carries all four, so there is no partial write and no order in which two
 * requests can interleave into a policy nobody chose. A per-row mutation would be a
 * smaller payload and a worse contract.
 *
 * **Returns what was stored**, unlike `connections.trust.set` which returns nothing. The
 * reason they differ is the reason that one is silent: a trust value is private and
 * echoing it back is a payload M2-AC3 has to re-prove is unreachable. A privacy limit is
 * the caller's own policy about themselves, it has no second party, and the screen's
 * pickers have to settle on the value the server actually accepted rather than the one
 * the client optimistically drew.
 *
 * **No outbox event.** Nothing downstream reacts to a policy change: `app.visible_people`
 * reads the table on every call, so the next read is already correct. An event
 * announcing "this person tightened their privacy" would be a notification that a person
 * became less visible — which is the disclosure the setting exists to prevent.
 */
export function createSetPrivacyLimitsService(
  dependencies: SetPrivacyLimitsDependencies,
): SetPrivacyLimitsService {
  const readClock = dependencies.now ?? ((): Date => new Date());

  return {
    async set(command: SetPrivacyLimitsCommand): Promise<PrivacyLimits> {
      const limits = validatePrivacyLimits(command.limits);

      await dependencies.limits.set({
        ownerId: command.actorId,
        limits,
        assignedAt: readClock(),
      });

      return limits;
    },
  };
}

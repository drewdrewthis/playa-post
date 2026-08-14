import { NOTIFICATION_KINDS, type NotificationKind } from '../domain/notification-kind';
import type { NotificationOptoutRepository } from '../domain/notification-optout.repository';

/** One kind's switch position, as the settings read serves it. */
export interface NotificationSetting {
  readonly kind: NotificationKind;
  /** Derived from the **absence** of an opt-out row — on is never stored (ADR-0020 D3). */
  readonly enabled: boolean;
}

/** Collaborators, injected rather than resolved (addendum §12, ADR-0003). */
export interface NotificationSettingsDependencies {
  readonly optouts: NotificationOptoutRepository;
}

/**
 * Read and write the caller's own per-kind notification switches (issue #209).
 *
 * `userId` is the internal `app.users.id` the transport resolved from the verified
 * token via `authenticatedProcedure` — never a caller-supplied field (ADR-0002:180-181).
 * There is deliberately no way to address anybody else's settings through this service.
 *
 * Both methods answer the **full** settings list, one entry per `NOTIFICATION_KINDS`
 * member in that order, so a client renders the panel from the response and never
 * hardcodes kinds — a new kind arrives in the list before any client knows its name.
 */
export interface NotificationSettingsService {
  /** The caller's current switches — every kind, whether or not they ever flipped one. */
  get(userId: string): Promise<readonly NotificationSetting[]>;
  /**
   * Move one switch and return where they all now stand. Idempotent in both
   * directions: the repository absorbs a repeat, so a retry converges.
   */
  update(
    userId: string,
    kind: NotificationKind,
    enabled: boolean,
  ): Promise<readonly NotificationSetting[]>;
}

export function createNotificationSettingsService(
  dependencies: NotificationSettingsDependencies,
): NotificationSettingsService {
  const settingsFor = async (userId: string): Promise<readonly NotificationSetting[]> => {
    const optedOut = await dependencies.optouts.findOptedOutKinds(userId);
    return NOTIFICATION_KINDS.map((kind) => ({ kind, enabled: !optedOut.has(kind) }));
  };

  return {
    get: settingsFor,

    async update(
      userId: string,
      kind: NotificationKind,
      enabled: boolean,
    ): Promise<readonly NotificationSetting[]> {
      if (enabled) {
        await dependencies.optouts.optIn(userId, kind);
      } else {
        await dependencies.optouts.optOut(userId, kind);
      }
      return settingsFor(userId);
    },
  };
}

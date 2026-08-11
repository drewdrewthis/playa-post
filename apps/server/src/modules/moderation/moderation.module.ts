import type { DatabaseConnection } from '@playa-post/database';

import { createDismissBulletinService } from './application/dismiss-bulletin.service';
import type { FindVisibleBulletin } from './application/find-visible-bulletin';
import { createReportBulletinService } from './application/report-bulletin.service';
import { createUndismissBulletinService } from './application/undismiss-bulletin.service';
import type { ModerationRepository } from './domain/moderation.repository';
import { createPostgresModerationRepository } from './persistence/postgres-moderation.repository';
import { createModerationRouter, type ModerationRouter } from './transport/moderation.router';

/** What the composition root has to hand this module. */
export interface ModerationModuleDependencies {
  /** Connected as `app_rw` and nothing else (ADR-0002 §2). */
  readonly database: DatabaseConnection;
  /**
   * See {@link FindVisibleBulletin}.
   *
   * ⚠ It comes **in**, and cannot be built here: `modules/bulletins` owns the
   * authorized bulletin read, and importing its repository would be a
   * `no-cross-module-persistence` violation while re-deriving it would be the second
   * visibility rule ADR-0002 §6 exists to forbid.
   */
  readonly findVisibleBulletin: FindVisibleBulletin;
}

/** What the composition root gets back: a router to mount. */
export interface ModerationModule {
  readonly router: ModerationRouter;
}

/** What building the board exclusion needs. */
export interface HiddenBulletinsDependencies {
  /** Connected as `app_rw` and nothing else (ADR-0002 §2). */
  readonly database: DatabaseConnection;
}

/**
 * The board-exclusion read, on its own — the port `modules/bulletins`' board consumes
 * to leave out what this viewer has reported or dismissed.
 *
 * **A second entry point rather than a field on {@link ModerationModule}, because the
 * two modules need each other and something has to be constructible first.** Moderation
 * needs bulletins' authorized read to decide whether an actor may moderate a bulletin
 * at all; bulletins needs this to decide what to leave off a board. Exposing the read
 * half separately breaks that cycle with an ordinary top-to-bottom wiring order in
 * `composition/container.ts` instead of a lazily-captured reference, which is the kind
 * of cleverness a composition root should never need.
 *
 * The return type is narrowed to the read: a caller gets "which bulletins has this
 * viewer hidden" and no way to hide one, so the write path stays behind
 * {@link ModerationModule}'s router where authorization is enforced.
 */
export function createHiddenBulletins(
  dependencies: HiddenBulletinsDependencies,
): Pick<ModerationRepository, 'findHiddenFor'> {
  return createPostgresModerationRepository({ database: dependencies.database });
}

/**
 * The Dismissed category's identifier read, on its own — the port
 * `modules/bulletins`' `bulletins.dismissed` consumes to learn *which* bulletins this
 * viewer dismissed (#170).
 *
 * **A third entry point rather than a wider {@link createHiddenBulletins}, because the
 * two reads must not be interchangeable.** `findHiddenFor` unions reports and dismissals;
 * this returns dismissals alone. Handing a caller an object that answers both makes
 * picking the wrong one a typo, and the wrong one here is a browsable list of what the
 * viewer reported — the surface M2-AC10/B9 exists to prevent. Two narrow return types mean
 * the compiler refuses the mistake instead of a reviewer having to catch it.
 */
export function createDismissedBulletins(
  dependencies: HiddenBulletinsDependencies,
): Pick<ModerationRepository, 'findDismissedFor'> {
  return createPostgresModerationRepository({ database: dependencies.database });
}

/**
 * Wire the moderation module.
 *
 * **This file is the module's only wiring point**, the same shape
 * `identity.module.ts` establishes: `application/` may not import `persistence/`
 * (`no-domain-to-infrastructure`), so somebody outside both layers builds the
 * repository and injects it.
 *
 * Nothing leaves this module besides the router and the read above. In particular
 * nothing exports "who reported this bulletin" — M2-AC10/B9 is a guarantee about every
 * response the *author* can reach, and the cheapest way to keep it is for the reporter's
 * identity to have no exported path out of this module at all.
 *
 * Called once per process from `composition/container.ts`. Constructing it touches no
 * socket: the pool connects lazily and the router is a data structure.
 */
export function createModerationModule(
  dependencies: ModerationModuleDependencies,
): ModerationModule {
  const moderation = createPostgresModerationRepository({ database: dependencies.database });
  const { findVisibleBulletin } = dependencies;

  return {
    router: createModerationRouter({
      reportBulletin: createReportBulletinService({ moderation, findVisibleBulletin }),
      dismissBulletin: createDismissBulletinService({ moderation, findVisibleBulletin }),
      undismissBulletin: createUndismissBulletinService({ moderation, findVisibleBulletin }),
    }),
  };
}

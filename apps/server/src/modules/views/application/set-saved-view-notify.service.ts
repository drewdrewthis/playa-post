import type { SavedViewRepository } from '../domain/saved-view.repository';

/** What toggling a view's bell is given. `actorId` is the resolved `Actor`'s, never input. */
export interface SetSavedViewNotifyCommand {
  readonly actorId: string;
  readonly viewId: string;
  readonly notify: boolean;
}

/** What the caller is told: which view the one bell is now lit on, if any. */
export interface NotifyMeDesignation {
  readonly notifyingViewId: string | null;
}

export interface SetSavedViewNotifyService {
  set(command: SetSavedViewNotifyCommand): Promise<NotifyMeDesignation>;
}

/** Collaborators, injected rather than resolved (addendum §12, ADR-0003). */
export interface SetSavedViewNotifyDependencies {
  readonly savedViews: SavedViewRepository;
  /** Reads the wall clock. Overridable so a test can pin `updated_at`. */
  readonly now?: (() => Date) | undefined;
}

/**
 * The Notify Me designation use case — the comp's per-view bell (issue #45, decision D1).
 *
 * ⚠ **Turning the bell on view B on turns it off on view A, and that is the whole
 * feature.** D1 resolved the PDF↔prototype conflict in the PDF's favour: there is exactly
 * one Notify Me query per user, and "the prototype's per-view bell becomes the UI
 * affordance for designating *which* view's query is the Notify Me query". This service
 * never counts rows to enforce that — `app.notify_me_queries`' primary key on `owner_id`
 * does, so a second notifying query is not a bug this code prevents but a row the
 * database cannot hold (ADR-0016).
 *
 * The query text copied onto the designation is the view's, as stored. Re-parsing it here
 * would let a grammar change silently reinterpret a saved query at designation time —
 * which is the exact failure `ast_version` exists to prevent (ADR-0007:70-72).
 *
 * @throws {import('../domain/saved-view.errors').SavedViewUnavailableError} when the view
 *   is not one of this actor's — the same answer an invented ID gets (M5-AC16).
 */
export function createSetSavedViewNotifyService(
  dependencies: SetSavedViewNotifyDependencies,
): SetSavedViewNotifyService {
  const readClock = dependencies.now ?? ((): Date => new Date());

  return {
    async set(command: SetSavedViewNotifyCommand): Promise<NotifyMeDesignation> {
      return {
        notifyingViewId: await dependencies.savedViews.setNotify({
          ownerId: command.actorId,
          viewId: command.viewId,
          notify: command.notify,
          changedAt: readClock(),
        }),
      };
    },
  };
}

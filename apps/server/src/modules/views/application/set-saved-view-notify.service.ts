import type { SavedViewRepository } from '../domain/saved-view.repository';

/** What toggling a view's bell is given. `actorId` is the resolved `Actor`'s, never input. */
export interface SetSavedViewNotifyCommand {
  readonly actorId: string;
  readonly viewId: string;
  readonly notify: boolean;
}

/**
 * What the caller is told: every view their bells are now lit on.
 *
 * The whole set rather than the view just toggled, so a client that raced another device
 * re-renders from the server's answer instead of patching its own copy.
 */
export interface NotifyMeDesignation {
  readonly notifyingViewIds: readonly string[];
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
 * The Notify Me designation use case — the comp's per-view bell (issue #45, #172).
 *
 * ⚠ **Every bell is its own switch, and that is decision D16 reopening D1.** D1 read the
 * PDF's "one special saved query called Notify Me" as exactly one per user, so turning the
 * bell on view B on turned it off on view A; the owner has since asked for the prototype's
 * plain reading, and a person may now notify on several views at once. What did not change
 * is where the truth lives: this service still never counts rows to keep bells from
 * colliding, because `app.notify_me_queries`' unique constraint on
 * `(owner_id, source_view_id)` is what makes one bell one row (ADR-0016, D16).
 *
 * The query text copied onto a designation is the view's, as stored. Re-parsing it here
 * would let a grammar change silently reinterpret a saved query at designation time —
 * which is the exact failure `ast_version` exists to prevent (ADR-0007:70-72).
 *
 * @throws {import('../domain/saved-view.errors').SavedViewUnavailableError} when the view
 *   is not one of this actor's — the same answer an invented ID gets (M5-AC16).
 * @throws {import('../domain/notify-me-query.errors').NotifyMeQueryLimitReachedError} when
 *   lighting this bell would take the actor past the per-owner cap that bounds what the
 *   notification evaluator reads on every bulletin. The cap counts lit **bells** only, so
 *   the remedy it names — switch one off — always points at a card that can free the slot.
 */
export function createSetSavedViewNotifyService(
  dependencies: SetSavedViewNotifyDependencies,
): SetSavedViewNotifyService {
  const readClock = dependencies.now ?? ((): Date => new Date());

  return {
    async set(command: SetSavedViewNotifyCommand): Promise<NotifyMeDesignation> {
      return {
        notifyingViewIds: await dependencies.savedViews.setNotify({
          ownerId: command.actorId,
          viewId: command.viewId,
          notify: command.notify,
          changedAt: readClock(),
        }),
      };
    },
  };
}

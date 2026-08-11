import type { DismissedBulletinsRepository } from './dismissed-bulletins.repository';
import type { BoardPage } from './visible-bulletin';
import { BOARD_PAGE_SIZE, type VisibleBulletinsRepository } from './visible-bulletins.repository';

/**
 * What listing the Dismissed category is given.
 *
 * ⚠ `viewerId` is the reading actor's `app.users.id`, and it must arrive from the
 * `Actor` resolved at the tRPC context boundary — never from request input
 * (ADR-0002 §5a, B14). There is exactly one dismissed list a caller may read — their own
 * — so there is no parameter here that could name a different one.
 */
export interface ListDismissedBulletinsCommand {
  readonly viewerId: string;
}

export interface ListDismissedBulletinsQuery {
  list(command: ListDismissedBulletinsCommand): Promise<BoardPage>;
}

/** Collaborators, injected rather than resolved (addendum §12, ADR-0003). */
export interface ListDismissedBulletinsDependencies {
  readonly bulletins: VisibleBulletinsRepository;
  /**
   * What this viewer has dismissed, implemented by `modules/moderation` (#170). See
   * {@link DismissedBulletinsRepository}.
   *
   * **Required, unlike the board's optional `hiddenBulletins`.** A board with no
   * moderation wired behind it hides nothing, which is a legitimate configuration; a
   * Dismissed category with no dismissals behind it is not a category at all, so this
   * query cannot be built without one and no caller has to wonder what an absent one
   * would mean.
   */
  readonly dismissedBulletins: DismissedBulletinsRepository;
}

/**
 * The Dismissed category (#170) — the viewer's own dismissals, made browsable.
 *
 * **Two steps, in this order, and the order is what keeps it a narrowing.** Ask
 * `modules/moderation` which bulletins this viewer dismissed, then ask
 * `app.visible_bulletins` which of those they may still be shown. The identifiers are
 * *candidates*, never a grant: an ID the viewer may not see returns nothing, so the fact
 * that they came from a second module's table cannot widen what this read can reach
 * (ADR-0002 B10, §6).
 *
 * That is also why a dismissed bulletin can leave this list without anybody dismissing or
 * un-dismissing anything. Its author archived it, or the connection that made it
 * reachable is gone — the row in `app.bulletin_dismissals` survives, the bulletin does
 * not, and the category shows what it can show. Keeping the row is deliberate: if the
 * bulletin becomes visible again, the viewer's decision about it is still on record.
 *
 * ⚠ **The order is dismissal order, restored here rather than promised by the
 * repository.** `findDismissedFor` returns identifiers newest-dismissal-first because
 * only its table knows when each dismissal happened; `findVisibleByIds` promises no order
 * at all, because it was handed a set. This function is the one place the two facts meet,
 * so it is the one place the order can be stated without either half claiming to know
 * something it does not.
 *
 * ⚠ **No pagination, matching the board.** At most
 * {@link import('./visible-bulletins.repository').BOARD_PAGE_SIZE} dismissals are
 * considered, so a viewer who has dismissed more sees their most recent ones. A cursor
 * arrives with the board's (M5) — the same `BoardPage` shape is returned precisely so it
 * arrives for both at once.
 */
export function createListDismissedBulletinsQuery(
  dependencies: ListDismissedBulletinsDependencies,
): ListDismissedBulletinsQuery {
  return {
    async list(command: ListDismissedBulletinsCommand): Promise<BoardPage> {
      const dismissedIds = await dependencies.dismissedBulletins.findDismissedFor(
        command.viewerId,
        BOARD_PAGE_SIZE,
      );

      const visible = await dependencies.bulletins.findVisibleByIds(
        command.viewerId,
        dismissedIds,
      );

      const byId = new Map(visible.map((bulletin) => [bulletin.id, bulletin]));

      // Walk the dismissal order and keep what survived the authorized read, rather than
      // sorting the authorized rows: a bulletin the viewer may no longer see has no entry
      // to sort, and expressing "drop it" as a lookup miss means there is no second place
      // that decides what absence means.
      return {
        items: dismissedIds.flatMap((bulletinId) => {
          const bulletin = byId.get(bulletinId);

          return bulletin === undefined ? [] : [bulletin];
        }),
      };
    },
  };
}

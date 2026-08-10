import type { VisibleIntroInboxRow } from './visible-intro';
import type { VisibleIntrosRepository } from './visible-intros.repository';

/**
 * What reading the intro inbox is given. Nothing but the resolved viewer.
 *
 * ⚠ `viewerId` is the reading actor's `app.users.id`, and it must arrive from the `Actor`
 * resolved at the tRPC context boundary — never from request input (ADR-0002 §5a, B14).
 *
 * There is no filter, no role selector, and no other person's ID — so there is nothing
 * here a caller could aim at somebody else's inbox even if a field appeared. The role
 * discriminator is computed from which column matched, never chosen.
 */
export interface ListIntroInboxCommand {
  readonly viewerId: string;
}

export interface ListIntroInboxQuery {
  list(command: ListIntroInboxCommand): Promise<readonly VisibleIntroInboxRow[]>;
}

/** Collaborators, injected rather than resolved (addendum §12, ADR-0003). */
export interface ListIntroInboxDependencies {
  readonly intros: VisibleIntrosRepository;
}

/**
 * The dual-role intro inbox (issue #89).
 *
 * One step, and the thinness is the design: which rows a viewer may read is one
 * statement in `persistence/`, so there is nothing for this layer to add. A merge with
 * the notifications feed, or a "mark as seen" side effect written here, would each be a
 * rule with no second implementation to keep it honest.
 *
 * ⚠ **Do not add a status filter parameter.** The two role/status pairings are the
 * authorization — a target may see `passed_on` and a via may see `requested`, and nothing
 * else is ever returned — so a parameter that narrowed them would be harmless and a
 * parameter that widened them would be the whole bug.
 */
export function createListIntroInboxQuery(
  dependencies: ListIntroInboxDependencies,
): ListIntroInboxQuery {
  return {
    async list(command: ListIntroInboxCommand): Promise<readonly VisibleIntroInboxRow[]> {
      return dependencies.intros.findInboxFor(command.viewerId);
    },
  };
}

import type { VisibleIntroOutboxRow } from './visible-intro';
import type { VisibleIntrosRepository } from './visible-intros.repository';

/**
 * What reading your own intro asks is given. Nothing but the resolved viewer.
 *
 * ⚠ `viewerId` is the reading actor's `app.users.id`, and it must arrive from the `Actor`
 * resolved at the tRPC context boundary — never from request input (ADR-0002 §5a, B14).
 */
export interface ListIntroOutboxCommand {
  readonly viewerId: string;
}

export interface ListIntroOutboxQuery {
  list(command: ListIntroOutboxCommand): Promise<readonly VisibleIntroOutboxRow[]>;
}

/** Collaborators, injected rather than resolved (addendum §12, ADR-0003). */
export interface ListIntroOutboxDependencies {
  readonly intros: VisibleIntrosRepository;
}

/**
 * What this person has asked for, and what came of it (issue #89).
 *
 * ⚠ **A declined request appears here, and it appears with no reason.** Hiding it would
 * strand the requester waiting on an answer that already came; explaining it would expose
 * the via's rationale, which is theirs. "Not passed on" is the whole of the disclosure,
 * and there is deliberately no re-ask affordance attached to it — the pair is free to ask
 * again (the open-per-pair index is partial), but a button offering to is a decline
 * turned into a prompt.
 */
export function createListIntroOutboxQuery(
  dependencies: ListIntroOutboxDependencies,
): ListIntroOutboxQuery {
  return {
    async list(command: ListIntroOutboxCommand): Promise<readonly VisibleIntroOutboxRow[]> {
      return dependencies.intros.findOutboxFor(command.viewerId);
    },
  };
}

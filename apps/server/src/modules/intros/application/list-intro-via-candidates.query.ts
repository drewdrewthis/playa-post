import type { IntroPerson } from './intro-person';
import type { VisibleIntrosRepository } from './visible-intros.repository';

/**
 * What listing intro candidates is given.
 *
 * ⚠ `requesterId` is the reading actor's `app.users.id`, and it must arrive from the
 * `Actor` resolved at the tRPC context boundary — never from request input (ADR-0002
 * §5a, B14).
 *
 * `targetId` **is** client-chosen, which `graph.list` deliberately never is. That is a
 * considered exception with the same shape as `connections.connection.get`'s
 * `otherUserId`: every candidate this returns is already a first-degree person on the
 * caller's own `graph.list` payload, and rows come back only when the target is already
 * on that graph — so the procedure discloses nothing the caller was not already holding,
 * and an unreachable or invented id yields an empty list rather than an error that
 * distinguishes it.
 */
export interface ListIntroViaCandidatesCommand {
  readonly requesterId: string;
  readonly targetId: string;
}

export interface ListIntroViaCandidatesQuery {
  list(command: ListIntroViaCandidatesCommand): Promise<readonly IntroPerson[]>;
}

/** Collaborators, injected rather than resolved (addendum §12, ADR-0003). */
export interface ListIntroViaCandidatesDependencies {
  readonly intros: VisibleIntrosRepository;
}

/**
 * "Who could introduce me to them" (issue #89).
 *
 * One step, and the thinness is the design: the whole of the eligibility rule lives in
 * `app.intro_via_candidates`, so there is nothing for this layer to add. A filter, a
 * ranking, or a "you have already asked" annotation written here would each be a rule the
 * request path could then disagree with — and the request path is the one that decides.
 */
export function createListIntroViaCandidatesQuery(
  dependencies: ListIntroViaCandidatesDependencies,
): ListIntroViaCandidatesQuery {
  return {
    async list(command: ListIntroViaCandidatesCommand): Promise<readonly IntroPerson[]> {
      return dependencies.intros.findViaCandidates(command.requesterId, command.targetId);
    },
  };
}

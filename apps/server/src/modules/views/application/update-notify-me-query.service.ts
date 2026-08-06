import { parseBoardQuery } from '../domain/board-query-grammar';
import { NOTIFY_ME_AST_VERSION, type NotifyMeQuery } from '../domain/notify-me-query';
import type { NotifyMeQueryRepository } from '../domain/notify-me-query.repository';

/**
 * What updating a Notify Me query is given.
 *
 * `actorId` comes from the `Actor` resolved at the tRPC context boundary, never from
 * the request body (ADR-0002:180-181), and there is **no field naming a query** — the
 * primary key is `owner_id` (ADR-0007:79), so the actor *is* the address. An actor
 * unrelated to somebody else's query has no way to name it, which is how M2-AC19's
 * scenario resolves: supplying another person's `expectedVersion` mismatches the
 * actor's **own** state and is refused before a column of anybody else's row is read.
 */
export interface UpdateNotifyMeQueryCommand {
  readonly actorId: string;
  /** Raw text as the person typed it; validated here, stored beside its AST. */
  readonly sourceText: string;
  /** ADR-0005:98. Absent means "I believe I have no saved query yet". */
  readonly expectedVersion?: number | undefined;
}

export interface UpdateNotifyMeQueryService {
  update(command: UpdateNotifyMeQueryCommand): Promise<NotifyMeQuery>;
}

/** Collaborators, injected rather than resolved (addendum §12, ADR-0003). */
export interface UpdateNotifyMeQueryDependencies {
  readonly notifyMeQueries: NotifyMeQueryRepository;
  /** Reads the wall clock. Overridable so a test can pin `updated_at`. */
  readonly now?: (() => Date) | undefined;
}

/**
 * The update-Notify-Me use case (M2.10) — ADR-0005's `notifyMe.update`.
 *
 * Two steps and no third: validate the text through **the** grammar, then hand one
 * atomic write to the repository. The `NotifyMeQueryChanged` outbox row is written
 * inside that same transaction (ADR-0006), not published from here.
 *
 * **Both the source text and the validated AST are stored** (ADR-0007:77-79). Storing
 * only the text would make `EvaluateNotifyMeHandler` re-parse untrusted input on every
 * `BulletinCreated`; storing only the AST would lose what the person typed and make a
 * round-trip into the edit box a lossy re-serialization of their own words.
 *
 * There is deliberately no read-then-compare-then-write: the version predicate lives
 * in the `WHERE` clause of one conditional statement, so a concurrent update cannot
 * win a race against a check that already passed, and actorship cannot be reordered
 * after version comparison by a later edit (ADR-0005 precedence rule 1).
 *
 * @throws {import('../domain/board-query-grammar').InvalidBoardQueryError} naming the
 *   offending token — a refused query is never silently narrowed to what parsed
 *   (ADR-0007:53-56).
 * @throws {import('../domain/notify-me-query.errors').NotifyMeQueryConflictError} on
 *   a version mismatch, carrying none of the stored state.
 */
export function createUpdateNotifyMeQueryService(
  dependencies: UpdateNotifyMeQueryDependencies,
): UpdateNotifyMeQueryService {
  const readClock = dependencies.now ?? ((): Date => new Date());

  return {
    async update(command: UpdateNotifyMeQueryCommand): Promise<NotifyMeQuery> {
      const query = parseBoardQuery(command.sourceText);

      return dependencies.notifyMeQueries.save({
        ownerId: command.actorId,
        sourceText: command.sourceText,
        query,
        astVersion: NOTIFY_ME_AST_VERSION,
        updatedAt: readClock(),
        ...(command.expectedVersion === undefined ? {} : { expectedVersion: command.expectedVersion }),
      });
    },
  };
}

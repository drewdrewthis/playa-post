/** Milliseconds in a day, so the retention window can be stated in the unit it is configured in. */
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * One store this sweep empties of rows somebody deleted long enough ago.
 *
 * ⚠ **Structurally satisfied by each module's own purge port** —
 * `modules/views`' `DeletedSavedViewsRepository` and `modules/bulletins`'
 * `RemovedBulletinsRepository` — and deliberately narrower than either. An entrypoint
 * that named those types would know which modules exist and which of their tables carry
 * a soft delete, which is precisely the coupling `entrypoints/**` exists to not have.
 * The same arrangement `NotificationFlusher` has with `SendGroupedPushHandler`, and
 * `OutboxDrainer` has with its consumers: the composition root is the one place that
 * already knows both halves.
 *
 * Adding a third deletable entity is therefore a new port, a new implementation, and one
 * line in `composition/container.ts` — nothing in this directory changes.
 */
export interface PurgeTarget {
  /**
   * What this target sweeps, for the round's own report.
   *
   * A fixed label chosen by the composition root, never user content and never a value
   * read from a row: this string reaches a log line (see {@link SoftDeletedRowPurge}).
   */
  readonly name: string;
  /**
   * Hard-delete everything soft-deleted strictly before `deletedBefore`, and answer how
   * many rows went.
   */
  purge(deletedBefore: Date): Promise<number>;
}

/** What one target removed in one round. */
export interface PurgedRows {
  /** {@link PurgeTarget.name}, unchanged. */
  readonly name: string;
  readonly rows: number;
}

/** What one round of the sweep did. */
export interface PurgeRoundResult {
  /** The cutoff this round used — `now` minus the configured retention window. */
  readonly deletedBefore: Date;
  /** One entry per target, in the order they were swept. */
  readonly purged: readonly PurgedRows[];
  /** Every target's count, summed. Zero is the steady state. */
  readonly totalRows: number;
}

/** The purge entrypoint's public surface (issue #169). */
export interface SoftDeletedRowPurge {
  /**
   * Sweep every target once, using `now` to derive the cutoff.
   *
   * One call is one round. The caller decides the cadence — a poll interval on the Node
   * server (`start-purge-poller.ts`), or once per call in a test.
   *
   * @throws whatever a target threw. See {@link createSoftDeletedRowPurge} on why a
   *   failing target ends the round instead of being stepped over.
   */
  purgeOnce(command: { readonly now: Date }): Promise<PurgeRoundResult>;
}

/** What {@link createSoftDeletedRowPurge} needs, injected (addendum §12). */
export interface CreateSoftDeletedRowPurgeDependencies {
  /**
   * How many days a soft-deleted row is kept — `PURGE_RETENTION_DAYS`, read once by the
   * composition root and handed here.
   *
   * ⚠ **The window is the only thing about this sweep that is configurable.** How often
   * it runs is a constant in `start-purge-poller.ts`: an operator has a policy about how
   * long deleted data lives, and no opinion at all about poll intervals — exposing the
   * cadence would be a knob whose every setting produces the same retention.
   */
  readonly retentionDays: number;
  /** Every store to sweep. Empty is legal and sweeps nothing. */
  readonly targets: readonly PurgeTarget[];
}

/**
 * Build the soft-delete purge (issue #169, and the gap [#118] named).
 *
 * **This is what makes a soft delete a delete.** Every user-facing delete in this product
 * stamps a column rather than removing a row — `app.bulletins.archived_at`,
 * `app.saved_views.deleted_at` — which is right for recoverability and wrong forever
 * afterwards: without a sweep, "removed" means "hidden and kept indefinitely", and the
 * person who removed something has been told a thing that is not true.
 *
 * ⚠ **Targets are swept one after another, and a failing one ends the round.** Two
 * decisions, both about the same property — this sweep is idempotent and re-runs on a
 * short interval forever, so the cost of a round that stops early is one interval, and
 * the alternative is worse in a way nothing would notice: a purge that catches per target
 * and reports success is a purge that can be broken for months while its log says it
 * swept. Sequential rather than concurrent for the ordinary reason — two large `DELETE`s
 * racing each other for pool connections buy nothing when the next round is minutes away.
 *
 * ⚠ **No transaction spans the targets, and there is nothing to make atomic across
 * them.** A deleted saved view and a removed bulletin share no invariant; each target's
 * own statement is atomic on its own, and holding one transaction open across both would
 * lengthen the locks to guarantee something nobody needs.
 *
 * ⚠ **No outbox event, from here or from any target.** Retention housekeeping is not a
 * state change anybody made — the state change was the delete, thirty days earlier, and
 * it published whatever it owed then. An event here would tell a consumer "this was
 * deleted" about something already absent from every read since, and would durably record
 * that somebody deleted something long after the fact (ADR-0006, M2-AC16). The one thing
 * that *is* recorded is the count, which is what the poller logs.
 *
 * Nothing here reads the environment or names a table: the cutoff arithmetic is the whole
 * of this file's logic, and every statement lives in the module that owns its rows.
 */
export function createSoftDeletedRowPurge(
  dependencies: CreateSoftDeletedRowPurgeDependencies,
): SoftDeletedRowPurge {
  const { retentionDays, targets } = dependencies;

  return {
    async purgeOnce(command: { readonly now: Date }): Promise<PurgeRoundResult> {
      const deletedBefore = new Date(command.now.getTime() - retentionDays * MILLISECONDS_PER_DAY);
      const purged: PurgedRows[] = [];

      for (const target of targets) {
        // Every target gets the same cutoff, derived once: reading the clock per target
        // would let two of them disagree about where the window starts, so a row deleted
        // in the microseconds between could be swept from one store and kept in another.
        purged.push({ name: target.name, rows: await target.purge(deletedBefore) });
      }

      return {
        deletedBefore,
        purged,
        totalRows: purged.reduce((total, entry) => total + entry.rows, 0),
      };
    },
  };
}

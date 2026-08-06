import type { DatabaseConnection } from '@playa-post/database';

import type { OutboxConsumer } from './outbox-consumer';
import type { OutboxEventRecord } from './outbox-event';

/** Statuses a claim query considers up for grabs (ADR-0006). Never `'dead'`. */
const CLAIMABLE_STATUSES: readonly string[] = ['pending', 'claimed'];

/** ADR-0006: "Max 8 attempts → status='dead'". */
const MAX_ATTEMPTS = 8;

/**
 * ADR-0006 retry backoff: `available_at = now() + least(15 min, 5s * attempts^2)`.
 *
 * Computed here in TypeScript rather than in SQL: `Math.min` is the same
 * two-argument formula ADR-0006 writes as SQL's `least`, nothing requires the
 * computation to happen in the database, and doing it here needs no
 * `pg_catalog.least(...)` qualification — which does not exist as a callable
 * function and is the mistake this note exists to prevent repeating.
 */
const MAX_BACKOFF_SECONDS = 15 * 60;
const BACKOFF_BASE_SECONDS = 5;

/**
 * How long a freshly-claimed row is protected from being claimed again, matching
 * ADR-0006's "a claimed row untouched for 5 minutes is reclaimable — crash recovery
 * costs nothing extra".
 *
 * Without this, a row would be immediately re-claimable the instant one drainer's
 * claim transaction commits (before that drainer has had a chance to dispatch to its
 * consumers and record an outcome), because `'claimed'` is itself one of
 * {@link CLAIMABLE_STATUSES} — that set exists precisely so a *stuck* claim can be
 * recovered, not so a live one can be double-claimed. Setting `available_at` forward
 * at claim time is what turns "claimed" into "claimed, and not reclaimable for a
 * while" rather than "claimed in name only".
 */
const CLAIM_LEASE_SECONDS = 5 * 60;

/** `drainOnce()`'s default batch size when the caller does not choose one. */
const DEFAULT_CLAIM_LIMIT = 10;

/** What {@link createOutboxDrainer} needs, injected (addendum §12). */
export interface CreateOutboxDrainerDependencies {
  /** Connected as `app_rw` and nothing else (ADR-0002 §2). */
  readonly database: DatabaseConnection;
  /** Every consumer this drainer instance dispatches claimed events to. */
  readonly consumers: readonly OutboxConsumer[];
  /** `app.outbox_events.claimed_by` — identifies which drainer instance claimed a row. */
  readonly drainerId: string;
  /**
   * `app.outbox_events.event_type` values this drainer must never claim, because some
   * other scheduled reader already owns them.
   *
   * ⚠ **Omitting a type that a module drains itself starves that module's reader**:
   * both would race for the same rows, and whichever claimed first would mark them
   * `claimed` — invisible to the other's `status='pending'` sweep — and then publish
   * them without performing the effect. The concrete instance is `NotifyMeMatched`,
   * which `modules/notifications`' grouping-window flush reads on its own 60-second
   * schedule (ADR-0006 §"Scheduled (cron) work"); that module declares the list beside
   * the event constant and the composition root passes it here.
   *
   * Injected rather than named in this file so the generic drainer keeps knowing
   * nothing about any module — the composition root is the one place that already
   * knows both halves. Omitted → nothing is excluded, which is the correct default for
   * a system whose event types are all drained here.
   */
  readonly excludedEventTypes?: readonly string[] | undefined;
}

export interface DrainOnceOptions {
  /** Maximum rows to claim this round. Omitted → {@link DEFAULT_CLAIM_LIMIT}. */
  readonly limit?: number;
}

export interface DrainOnceResult {
  /** Every event this call claimed, whether its consumers succeeded or not. */
  readonly claimedEventIds: readonly string[];
}

/** The outbox-drainer entrypoint's public surface (m2-lane-briefs.md §L3b-infra). */
export interface OutboxDrainer {
  /**
   * Claim up to `limit` due events and hand each to every registered consumer.
   *
   * One call is one round: claim, dispatch, record the outcome. The caller decides
   * the cadence — a poll interval on the Node target (ADR-0006), or once per call in
   * a test. Never rejects because a consumer failed; that failure is recorded on the
   * row (backoff or dead-letter) and draining continues with the next claimed row.
   */
  drainOnce(options?: DrainOnceOptions): Promise<DrainOnceResult>;
}

/**
 * Build an outbox drainer (ADR-0006, ADR-0009 — in-process on the Node server, no cron
 * variant, no second service; m2-lane-briefs.md §L3b-infra: "an entrypoint, not a
 * module").
 *
 * **Claiming.** One transaction: `SELECT … FOR UPDATE SKIP LOCKED LIMIT $limit`
 * (ordered by `available_at`) locks a batch with no leader election and no advisory
 * locks, then `UPDATE … WHERE event_id IN (…)` marks exactly those rows
 * `status='claimed'`, increments `attempts`, and extends the lease — in the same
 * transaction, so the row locks cover both statements. Two fluent-builder statements
 * rather than ADR-0006's single nested one, with the same atomicity and the same
 * concurrent-drainer guarantee (the `SKIP LOCKED` locks are held for the whole
 * transaction either way): chosen so this file needs no raw SQL literal —
 * `tests/fitness/no-sql-outside-persistence.fitness.test.ts` fails a `sql` tag or a
 * literal SQL string outside a `persistence/` directory, and this entrypoint has
 * neither.
 *
 * **Dispatch and outcome**, once the claim transaction has committed and released its
 * locks — a consumer may run its own transaction, and holding the claim lock open
 * across that would serialize drainers against each other for no reason. Every
 * claimed event goes to every registered consumer in turn. All succeed →
 * `status='published'`. Any consumer throws → `available_at` grows by
 * `least(15 min, 5s * attempts^2)`; at the 8th attempt the row is dead-lettered
 * (`status='dead'`) instead of retried, and a dead row is structurally unreachable to
 * a future claim — it fails `status IN ('pending','claimed')`.
 */
export function createOutboxDrainer(
  dependencies: CreateOutboxDrainerDependencies,
): OutboxDrainer {
  const { database, consumers, drainerId } = dependencies;
  const excludedEventTypes = dependencies.excludedEventTypes ?? [];

  return {
    async drainOnce(options: DrainOnceOptions = {}): Promise<DrainOnceResult> {
      const limit = options.limit ?? DEFAULT_CLAIM_LIMIT;
      const claimedEvents = await claimBatch(database, { drainerId, limit, excludedEventTypes });

      for (const event of claimedEvents) {
        await dispatchAndRecordOutcome(database, consumers, event);
      }

      return { claimedEventIds: claimedEvents.map((event) => event.eventId) };
    },
  };
}

/**
 * Lock and claim up to `limit` due events, atomically. Returns them mapped to
 * {@link OutboxEventRecord} — the shape every consumer, and the audit module's pure
 * mapping, are written against.
 */
async function claimBatch(
  database: DatabaseConnection,
  options: {
    readonly drainerId: string;
    readonly limit: number;
    readonly excludedEventTypes: readonly string[];
  },
): Promise<OutboxEventRecord[]> {
  const excluded = options.excludedEventTypes;

  return database.transaction().execute(async (transaction) => {
    const now = new Date();

    const candidates = await transaction
      .selectFrom('app.outbox_events')
      .select('event_id')
      .where('status', 'in', CLAIMABLE_STATUSES)
      .where('available_at', '<=', now)
      // The seam L3b-infra left for L3b-notify, now filled. `SendGroupedPushHandler`
      // reads `NotifyMeMatched` rows itself, on its own 60-second grouping-window
      // schedule — a second scheduled reader, not a consumer this drainer dispatches
      // to — so claiming one here would take it out from under that flush: `claimed`
      // fails the flush's `status='pending'` sweep, and this drainer would then mark
      // it `published` having delivered nothing. Which types those are is
      // `excludedEventTypes`' docstring; the list itself belongs to the module that
      // owns the second reader.
      //
      // `$if` rather than an unconditional `.where(...)`: Kysely renders an empty
      // `in` list as `event_type not in ()`, which is a syntax error in PostgreSQL —
      // so the default (nothing excluded) has to add no predicate at all rather than
      // an empty one.
      .$if(excluded.length > 0, (query) => query.where('event_type', 'not in', excluded))
      .orderBy('available_at')
      .limit(options.limit)
      .forUpdate()
      .skipLocked()
      .execute();

    if (candidates.length === 0) {
      return [];
    }

    const claimedIds = candidates.map((candidate) => candidate.event_id);

    const claimedRows = await transaction
      .updateTable('app.outbox_events')
      .set((eb) => ({
        status: 'claimed',
        claimed_at: now,
        claimed_by: options.drainerId,
        attempts: eb('attempts', '+', 1),
        available_at: new Date(now.getTime() + CLAIM_LEASE_SECONDS * 1000),
      }))
      .where('event_id', 'in', claimedIds)
      .returningAll()
      .execute();

    return claimedRows.map(
      (row): OutboxEventRecord => ({
        eventId: row.event_id,
        eventType: row.event_type,
        occurredAt: row.occurred_at,
        actorId: row.actor_id,
        aggregateId: row.aggregate_id,
        payload: row.payload as unknown as Record<string, unknown>,
        attempts: row.attempts,
      }),
    );
  });
}

/**
 * Hand one claimed event to every consumer, then write back what happened.
 *
 * Deliberately not wrapped in the claim transaction — see {@link createOutboxDrainer}'s
 * doc comment. Each consumer manages its own atomicity for its own effect; this
 * function only ever touches `app.outbox_events` itself.
 */
async function dispatchAndRecordOutcome(
  database: DatabaseConnection,
  consumers: readonly OutboxConsumer[],
  event: OutboxEventRecord,
): Promise<void> {
  try {
    for (const consumer of consumers) {
      await consumer.handle(event);
    }

    await database
      .updateTable('app.outbox_events')
      .set({ status: 'published' })
      .where('event_id', '=', event.eventId)
      .execute();
  } catch (error) {
    const backoffSeconds = Math.min(
      MAX_BACKOFF_SECONDS,
      BACKOFF_BASE_SECONDS * event.attempts ** 2,
    );
    const isDead = event.attempts >= MAX_ATTEMPTS;

    await database
      .updateTable('app.outbox_events')
      .set({
        status: isDead ? 'dead' : 'pending',
        available_at: new Date(Date.now() + backoffSeconds * 1000),
        last_error: error instanceof Error ? error.message : String(error),
      })
      .where('event_id', '=', event.eventId)
      .execute();
  }
}

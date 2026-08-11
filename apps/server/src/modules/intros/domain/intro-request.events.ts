import { INTRO_REQUEST_STATUS, type IntroRequest } from './intro-request';

/** Event type names, past tense (addendum §20). Stable — consumers subscribe to them. */
export const INTRO_REQUESTED = 'IntroRequested';
export const INTRO_PASSED_ON = 'IntroPassedOn';
export const INTRO_DECLINED = 'IntroDeclined';
export const INTRO_ACCEPTED = 'IntroAccepted';
export const INTRO_TARGET_DECLINED = 'IntroTargetDeclined';

/**
 * Something happened to an intro request.
 *
 * **Identifiers and routing data only.** ADR-0006 is explicit that a payload carries
 * what a consumer needs to *route*, never content: an outbox row is durable,
 * widely-read, and outlives the authorization state that produced it, so a consumer
 * re-reads what it needs through this module's authorized path — which also means it
 * cannot deliver something the current visibility rules no longer allow.
 *
 * ⚠ **`note` is absent and must stay absent.** An intro note is written by one person
 * about wanting to meet another, and an event carrying its text would put it in every
 * log line that dumps an outbox row and in every consumer's retry record. A notification
 * consumer says "someone asked you to make an introduction" and links to it; it never
 * quotes it. `intro-request.events.unit.test.ts` asserts the built payloads over
 * `JSON.stringify`, not over a field list, so a future field cannot smuggle it back in.
 *
 * All three parties travel because all three are what a delivery *routes* on — who to
 * notify differs per event type, and the alternative is a consumer reading the row back
 * just to learn who to tell. Each is an identifier that already crossed this boundary.
 */
interface IntroRequestEvent {
  readonly occurredAt: Date;
  /** The aggregate this event is about — `app.outbox_events.aggregate_id`. */
  readonly introRequestId: string;
  readonly requesterId: string;
  readonly viaId: string;
  readonly targetId: string;
  /** Who acted — `app.outbox_events.actor_id`. The requester, then the via. */
  readonly actorId: string;
}

/** Somebody asked to be introduced. Routed to the via. */
export interface IntroRequested extends IntroRequestEvent {
  readonly type: typeof INTRO_REQUESTED;
}

/** The via passed it on. Routed to the target, and back to the requester. */
export interface IntroPassedOn extends IntroRequestEvent {
  readonly type: typeof INTRO_PASSED_ON;
}

/**
 * The via declined. Routed to the requester and **never to the target**.
 *
 * ⚠ The event exists — the fact happened and the audit trail is entitled to it — and it
 * is the one event whose delivery must not reach one of the parties it names. A consumer
 * that told the target would undo the invariant the whole feature rests on.
 */
export interface IntroDeclined extends IntroRequestEvent {
  readonly type: typeof INTRO_DECLINED;
}

/**
 * The target accepted the introduction (issue #166).
 *
 * ⚠ **This event is the whole seam between `modules/intros` and `modules/connections`,
 * and it is load-bearing rather than an announcement.** Decision D12 routes connection
 * creation through the outbox: `modules/connections` subscribes to this type and writes
 * the edge between `requesterId` and `targetId` under its own receipt. Nothing here calls
 * that module, and nothing there reads this table.
 *
 * That means an unregistered consumer is not a late connection — it is a connection that
 * never forms, silently. `composition/container-notification-wiring.integration.test.ts`
 * is the only check that can catch it, for the reason `NotePinned`'s consumer has one.
 *
 * The three party identifiers it already carried are exactly what the connection needs;
 * no field was added for the seam. Routed to the requester as well: their introduction was
 * accepted, and that is the one outcome they are entitled to be told about — the target
 * disclosed it by connecting.
 */
export interface IntroAccepted extends IntroRequestEvent {
  readonly type: typeof INTRO_ACCEPTED;
}

/**
 * The target declined the introduction (issue #166).
 *
 * ⚠ Routed to nobody, and it is the second event in this module whose delivery must not
 * reach one of the parties it names — {@link IntroDeclined} being the first, one person
 * along. The requester must not be able to tell a decline from an introduction nobody has
 * answered yet, because a target who can be seen refusing cannot safely refuse. The fact
 * happened and the audit trail is entitled to it; the *delivery* is what must not exist.
 */
export interface IntroTargetDeclined extends IntroRequestEvent {
  readonly type: typeof INTRO_TARGET_DECLINED;
}

/** Any of the five. */
export type IntroEvent =
  | IntroRequested
  | IntroPassedOn
  | IntroDeclined
  | IntroAccepted
  | IntroTargetDeclined;

/**
 * Build the event for a request that has just been written.
 *
 * @param request - The stored row, so `introRequestId` is the real aggregate ID rather
 *   than one the caller hoped for, and `occurredAt` is the `created_at` the database
 *   committed.
 */
export function introRequested(request: IntroRequest): IntroRequested {
  return {
    type: INTRO_REQUESTED,
    occurredAt: request.createdAt,
    introRequestId: request.id,
    requesterId: request.requesterId,
    viaId: request.viaId,
    targetId: request.targetId,
    actorId: request.requesterId,
  };
}

/**
 * Build the event for a request the via has just decided.
 *
 * One builder for both decisions rather than two near-identical ones: the payload is the
 * same four identifiers either way, and the only thing that differs is the type name —
 * which is read from the row's own `status` rather than from a second argument the
 * caller could pass inconsistently with what was written.
 *
 * @param request - The row **as updated**, so `occurredAt` is the `decided_at` the
 *   database committed and `type` cannot disagree with the stored status.
 * @throws {Error} when the row carries no via decision, or carries one this builder does
 *   not name. Not an `ApplicationError`: no caller can produce this, so it is a
 *   programming mistake rather than a refusal, and silently emitting an `IntroDeclined`
 *   for an undecided row would be worse than a 500.
 */
export function introDecided(request: IntroRequest): IntroPassedOn | IntroDeclined {
  if (request.decidedAt === undefined) {
    throw new Error('introDecided: the request carries no decision');
  }

  const common = {
    occurredAt: request.decidedAt,
    introRequestId: request.id,
    requesterId: request.requesterId,
    viaId: request.viaId,
    targetId: request.targetId,
    actorId: request.viaId,
  };

  // ⚠ Both statuses named, rather than "passed on, else declined". Since #166 a decided
  // row can also be `accepted` or `target_declined` — the target answered a request the
  // via had passed on — and the negative form would have called every one of those an
  // `IntroDeclined`, announcing a refusal the via never made. It is unreachable through
  // the gated update, which only ever matches `requested`, but the shape that made it
  // reachable was one migration away and the throw costs nothing.
  if (request.status === INTRO_REQUEST_STATUS.passedOn) {
    return { type: INTRO_PASSED_ON, ...common };
  }

  if (request.status === INTRO_REQUEST_STATUS.declined) {
    return { type: INTRO_DECLINED, ...common };
  }

  throw new Error(`introDecided: ${request.status} is not a via decision`);
}

/**
 * Build the event for an introduction the target has just answered (issue #166).
 *
 * One builder for both responses, for {@link introDecided}'s reason: the payload is the
 * same four identifiers either way, and the type is read from the row's own `status`
 * rather than from a second argument a caller could pass inconsistently with what was
 * written.
 *
 * ⚠ **`occurredAt` is `respondedAt`, never `decidedAt`.** The two timestamps belong to
 * two different people; an acceptance stamped with the via's decision time would tell
 * every consumer — the audit trail included — that the target answered before they were
 * shown anything.
 *
 * @param request - The row **as updated**.
 * @throws {Error} when the row carries no answer, or carries a status no response
 *   produces. A programming mistake rather than a refusal, exactly as above.
 */
export function introResponded(request: IntroRequest): IntroAccepted | IntroTargetDeclined {
  if (request.respondedAt === undefined) {
    throw new Error('introResponded: the request carries no answer');
  }

  const common = {
    occurredAt: request.respondedAt,
    introRequestId: request.id,
    requesterId: request.requesterId,
    viaId: request.viaId,
    targetId: request.targetId,
    // The target acted. The via's name is on the row and travels for routing; the actor
    // is the person who made this particular fact happen.
    actorId: request.targetId,
  };

  if (request.status === INTRO_REQUEST_STATUS.accepted) {
    return { type: INTRO_ACCEPTED, ...common };
  }

  if (request.status === INTRO_REQUEST_STATUS.targetDeclined) {
    return { type: INTRO_TARGET_DECLINED, ...common };
  }

  throw new Error(`introResponded: ${request.status} is not a target answer`);
}

import { INTRO_REQUEST_STATUS, type IntroRequest } from './intro-request';

/** Event type names, past tense (addendum §20). Stable — consumers subscribe to them. */
export const INTRO_REQUESTED = 'IntroRequested';
export const INTRO_PASSED_ON = 'IntroPassedOn';
export const INTRO_DECLINED = 'IntroDeclined';

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

/** Any of the three. */
export type IntroEvent = IntroRequested | IntroPassedOn | IntroDeclined;

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
 * @throws {Error} when the row is still `requested`. Not an `ApplicationError`: no
 *   caller can produce this, so it is a programming mistake rather than a refusal, and
 *   silently emitting an `IntroDeclined` for an undecided row would be worse than a 500.
 */
export function introDecided(request: IntroRequest): IntroPassedOn | IntroDeclined {
  if (request.decidedAt === undefined || request.status === INTRO_REQUEST_STATUS.requested) {
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

  return request.status === INTRO_REQUEST_STATUS.passedOn
    ? { type: INTRO_PASSED_ON, ...common }
    : { type: INTRO_DECLINED, ...common };
}

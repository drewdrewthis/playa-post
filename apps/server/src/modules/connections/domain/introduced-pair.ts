/**
 * The one event type this module **subscribes to** (issue #166).
 *
 * `modules/intros` publishes it and owns the name; addendum §19 forbids importing another
 * module's domain, and ADR-0006 makes the *name* the contract a consumer subscribes to.
 * So the string is duplicated on purpose and the type is not — the same call
 * `modules/notifications` makes for `BulletinCreated` and `NotePinned`. A change to
 * intros' internal `IntroAccepted` interface must not ripple in here, and a change to the
 * published name is a breaking change that should show up as a consumer that stops
 * matching rather than as a compile error somebody is tempted to "fix" by coupling the
 * two modules.
 *
 * ⚠ **`IntroTargetDeclined` is deliberately absent, and its absence is the feature.** A
 * declined introduction has no effect anywhere: nothing is connected, and the requester is
 * never told. A consumer here for it would be a consumer with nothing to do and one edit
 * away from telling somebody.
 */
export const INTRO_ACCEPTED = 'IntroAccepted';

/**
 * The slice of an outbox event's envelope {@link toIntroducedPair} reads.
 *
 * Structurally compatible with `entrypoints/outbox-drainer/outbox-event.ts`'s
 * `OutboxEventRecord` — the drainer hands that shape to every consumer — but defined
 * locally rather than imported: `modules/<name>/domain/` may not depend on
 * `entrypoints/**` (`no-domain-to-infrastructure`), and the domain owning its own input
 * port is the correct direction of dependency regardless.
 *
 * Unlike `modules/audit`'s equivalent this one *does* carry `payload`, because the two
 * people to connect are named nowhere else: the envelope's `aggregate_id` is the intro
 * request and its `actor_id` is the target, but the requester exists only in the payload.
 */
export interface IntroAcceptedEnvelope {
  readonly eventType: string;
  readonly aggregateId: string;
  readonly occurredAt: Date;
  readonly payload: Record<string, unknown>;
}

/**
 * Two people an accepted introduction says should now be connected (issue #166).
 *
 * ⚠ **No disclosure levels and no trust.** An intro-formed connection is created at
 * exactly the columns' own defaults, which is what an accepted invite gets too — the
 * levels are `app.connections`' concern and trust lives in its own table (ADR-0002 B6).
 * A field here would be this module's second opinion about a value it already has one
 * answer for.
 */
export interface IntroducedPair {
  /** What to correlate the resulting `ConnectionAccepted` back to. */
  readonly introRequestId: string;
  readonly requesterId: string;
  readonly targetId: string;
  /**
   * When the target accepted — **not** when this event was delivered.
   *
   * The connection's `created_at` is the moment somebody agreed to it, so a redelivery
   * days later cannot write a connection that claims to have formed then. It is also what
   * makes the write deterministic: the same event always produces the same row.
   */
  readonly occurredAt: Date;
}

/** Read one identifier out of an untrusted payload, or `null` when it is not there. */
function identifier(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];

  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Read an `IntroAccepted` envelope as the pair to connect.
 *
 * Pure, so the shape of what gets written is testable without Postgres — the split
 * `modules/audit` makes between `toAuditEntry` and its handler.
 *
 * ⚠ **A malformed payload throws rather than connecting a guess.** Every other refusal in
 * this feature is a quiet one, and this is not that kind of failure: only
 * `modules/intros` writes this event, so a payload missing a party is a publisher bug, and
 * ADR-0006's retry-then-dead-letter path is where a publisher bug is supposed to surface.
 * The alternative — falling back to the envelope's `actor_id`, or skipping the event — is
 * a connection silently not made or, worse, made between the wrong two people.
 *
 * @throws {Error} when the event names no requester or no target, or names the same
 *   person twice. Not an `ApplicationError`: no caller can reach this, and there is no
 *   refusal to render.
 */
export function toIntroducedPair(event: IntroAcceptedEnvelope): IntroducedPair {
  const requesterId = identifier(event.payload, 'requesterId');
  const targetId = identifier(event.payload, 'targetId');

  if (requesterId === null || targetId === null || requesterId === targetId) {
    throw new Error('toIntroducedPair: IntroAccepted names no distinct pair to connect');
  }

  return {
    // The envelope's aggregate, not the payload's copy of it: the drainer read it from the
    // row's own `aggregate_id`, so it cannot disagree with the event it arrived on.
    introRequestId: event.aggregateId,
    requesterId,
    targetId,
    occurredAt: event.occurredAt,
  };
}

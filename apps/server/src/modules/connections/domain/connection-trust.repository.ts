import type { Trust } from './connection-trust';

/** One deliberate assignment of trust. */
export interface TrustAssignment {
  /** The person whose opinion this is. The only person who may ever read it back. */
  readonly ownerId: string;
  readonly subjectId: string;
  readonly trust: Trust;
  readonly assignedAt: Date;
}

/**
 * The directional-trust port.
 *
 * Declared here in `domain/` and implemented in `persistence/` (addendum §2).
 *
 * ⚠ Every method is keyed on `ownerId` **first**, and there is deliberately no
 * `findBySubject` or `findByConnection`. ADR-0002 B6 requires a trust value never to
 * leave its holder, and the cheapest way to guarantee that is an interface with no
 * shape that could answer "what does anyone else think of this person" — a caller who
 * cannot phrase the question cannot accidentally serialize the answer.
 */
export interface ConnectionTrustRepository {
  /**
   * The owner's own trust toward one subject.
   *
   * @returns `null` when the owner has never assigned one. **`null` is `unset`, and
   *   `unset` is not `0`** (ADR-0004:70-71): under this lane's ratified model unset is
   *   the absence of a row, so this is a genuine "no opinion recorded", distinct from
   *   a deliberate zero.
   */
  findOwn(ownerId: string, subjectId: string): Promise<number | null>;

  /**
   * Record the owner's trust toward the subject, replacing any previous value.
   *
   * An upsert rather than an insert-or-update pair: trust is idempotent by nature —
   * setting 85 twice is one opinion, not two — and the (owner, subject) primary key is
   * what makes that a single statement instead of a race.
   */
  set(assignment: TrustAssignment): Promise<void>;
}

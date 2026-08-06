import type { MutationOutcomeName } from './mutation-outcome';
import type { MutationType } from './mutation-type';

/** The idempotency record an earlier submission of one `mutationId` left behind. */
export interface StoredMutationResult {
  /**
   * The type the stored run applied.
   *
   * Compared on replay alongside {@link StoredMutationResult.requestHash}: two
   * different mutation types can carry byte-identical payloads (`{ bulletinId }` serves
   * archive, report, and dismiss alike), so the hash alone would let one type's stored
   * result answer another type's submission.
   */
  readonly mutationType: string;
  /** sha256 of the canonical payload that produced {@link StoredMutationResult.result}. */
  readonly requestHash: string;
  /** Exactly what the first, applied run returned. */
  readonly result: unknown;
}

/** One idempotency record, written in the same commit as the effect it describes. */
export interface NewMutationResult {
  readonly mutationId: string;
  /** Namespaces the record. See {@link MutationResultRepository.findByActorAndMutationId}. */
  readonly actorId: string;
  readonly mutationType: MutationType;
  readonly requestHash: string;
  readonly outcome: MutationOutcomeName;
  readonly result: unknown;
}

/**
 * The port onto `app.mutation_results` — ADR-0005's whole idempotency mechanism.
 *
 * Two methods, because there are two questions: "have I applied this before, and with
 * what payload" and "record that I have now". There is deliberately no `delete` and no
 * `update`: a result is a fact about something that already happened, and the 30-day
 * retention prune is a scheduled job (ADR-0006), not a call an application service
 * makes on the write path.
 */
export interface MutationResultRepository {
  /**
   * ⚠ **`actorId` is part of the key, in every lookup.** ADR-0005: "`mutation_id` is
   * client-generated but namespaced by `actor_id` in every lookup, so one actor cannot
   * probe or collide with another's mutation IDs." The primary key alone is global, so
   * a lookup on `mutation_id` by itself would answer "that id exists" — and would let
   * one actor replay into another's record — from a value the caller chose.
   *
   * @returns `null` when this actor has never submitted this `mutationId`.
   */
  findByActorAndMutationId(
    actorId: string,
    mutationId: string,
  ): Promise<StoredMutationResult | null>;

  /**
   * Record an applied mutation.
   *
   * Idempotent on `mutation_id`: two concurrent submissions of one envelope both apply
   * their effect and both call this, and the second must not fail the request it has
   * already served.
   */
  save(record: NewMutationResult): Promise<void>;
}

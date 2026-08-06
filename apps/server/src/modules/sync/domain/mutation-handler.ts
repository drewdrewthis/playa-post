import type { MutationType } from './mutation-type';

/**
 * One envelope, resolved into everything a handler or an actorship check may know.
 *
 * ⚠ `actorId` is the **resolved** actor, taken from the tRPC context and never from the
 * envelope (ADR-0002 §5a, B14). A handler that preferred an identifier out of `payload`
 * would reintroduce exactly the impersonation the envelope's shape rules out.
 */
export interface MutationCommand {
  readonly actorId: string;
  readonly mutationId: string;
  readonly mutationType: MutationType;
  /** Still `unknown` here: only the registered handler knows the shape. */
  readonly payload: unknown;
}

/** What applying a mutation produced, to be stored and returned on every replay. */
export interface MutationEffect {
  /**
   * Serialized into `app.mutation_results.result` and returned verbatim on replay, so
   * it must be JSON and must be the **same value the direct tRPC path would return** —
   * a client cannot be able to tell which transport applied its change.
   */
  readonly result: unknown;
}

/**
 * The adapter that turns one envelope into a call on the owning module's public
 * application interface (ADR-0005: "`sync` depends on modules' public application
 * interfaces and never on their internals" — §19).
 *
 * ⚠ **A handler never checks actorship.** That is the pre-dispatch gate's job
 * ({@link MutationActorshipCheck}), because it must run for every mutation type
 * including the ones with no handler at all. A handler that also checked would make the
 * ordering invisible and let the gate be removed without a test noticing.
 */
export interface MutationHandler {
  handle(command: MutationCommand): Promise<MutationEffect>;
}

/**
 * The type-agnostic, pre-dispatch verification of ADR-0005 precedence rule 1: every
 * identifier in the payload belongs to, or is reachable by, the authenticated actor.
 *
 * @throws {import('./sync.errors').MutationActorshipError} when it does not. Throwing
 *   rather than returning a boolean keeps "refused" impossible to ignore at the call
 *   site and lets a check raise the same class the direct tRPC path raises.
 */
export type MutationActorshipCheck = (command: MutationCommand) => Promise<void>;

/**
 * `MutationType → handler`, the registry ADR-0005's transport section describes.
 *
 * `Partial` because it is deliberately incomplete: M2 registers exactly one replayable
 * handler and the remaining six recognised types resolve to `undefined`, which is what
 * produces `rejected` / `UNSUPPORTED_MUTATION_TYPE` **after** the actorship gate.
 * Assembled in `composition/`, never inside a module — a module building this registry
 * would have to import every other module to fill it.
 */
export type MutationHandlerRegistry = Readonly<Partial<Record<MutationType, MutationHandler>>>;

/**
 * `MutationType → actorship check`, evaluated before dispatch.
 *
 * Separate from {@link MutationHandlerRegistry} rather than a field on the handler,
 * because the two maps have different membership on purpose: a type with a check and no
 * handler is precisely the case M2-AC19's B13 row needs (`bulletin.archive`), and it
 * cannot be expressed if a check can only exist attached to a handler.
 *
 * ⚠ A recognised type with **no** entry here is not gated. `bulletin.create` is the one
 * such type in M2 and is fail-closed by construction: the actor is the author, so there
 * is no subject for them to be unrelated to (see
 * `bulletins/application/create-bulletin.service.ts`). Every future type that names a
 * subject owes an entry here as part of its definition of done.
 */
export type MutationActorshipCheckRegistry = Readonly<
  Partial<Record<MutationType, MutationActorshipCheck>>
>;

import { z } from 'zod';

/**
 * One envelope on the wire.
 *
 * **`mutationType` is `z.string()`, not an enum, deliberately.** A closed wire
 * vocabulary here would make the input schema an oracle for which mutations this server
 * has shipped, and would answer an unrecognised type with a transport `BAD_REQUEST`
 * that fails the whole batch — where ADR-0005 requires a **per-envelope** `rejected`
 * carrying `UNSUPPORTED_MUTATION_TYPE`. `modules/sync/domain/mutation-type.ts` decides,
 * after the actorship gate has run.
 *
 * **`payload` is `z.unknown()`** because one procedure carries every mutation type:
 * there is no single shape to validate against, and the registered handler is the only
 * thing that knows the right one. It is checked there, and a mismatch comes back as
 * `MUTATION_PAYLOAD_INVALID` for that envelope alone.
 *
 * ⚠ **No `actorId`, `userId`, `viewerId`, or `ownerId` field** (ADR-0002:180-181,
 * B14) — not even though ADR-0005's envelope names `actorId`. An offline queue is the
 * most tempting place to accept one and the worst: a replayed envelope naming its own
 * author is total silent impersonation. `tests/fitness/viewer-id-provenance.fitness.test.ts`
 * walks the built router and fails on any such field.
 *
 * ⚠ **`payload` is `unknown`, so the walker cannot see inside it.** A handler must
 * therefore take the actor from {@link import('../domain/mutation-handler').MutationCommand}
 * and never from the payload — stated on that type, where a handler author reads it.
 */
const mutationEnvelopeInput = z.object({
  mutationId: z.uuid(),
  mutationType: z.string().min(1),
  clientCreatedAt: z.iso.datetime(),
  payload: z.unknown(),
});

/**
 * `sync.submitMutations`' input.
 *
 * **No `.max(50)` here.** The bound is `MAX_MUTATION_BATCH_SIZE` in
 * `domain/mutation-envelope.ts`, because M2-AC18 wants the stable
 * `MUTATION_BATCH_TOO_LARGE` code rather than a generic transport rejection — the same
 * split `bulletins`' title and body bounds already make.
 */
export const submitMutationsInput = z.object({
  mutations: z.array(mutationEnvelopeInput),
});

export type SubmitMutationsInput = z.infer<typeof submitMutationsInput>;

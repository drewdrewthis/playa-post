import { z } from 'zod';

import type { CreateBulletinCommand } from '../application/create-bulletin.service';
import { BULLETIN_TYPE } from '../domain/bulletin';

/**
 * `bulletins.create`'s input.
 *
 * **`title`, `body` and `loc` are `z.string()` and nothing more, deliberately.** Their
 * bounds live in `domain/bulletin-content.policy.ts`, and restating them here would make
 * an over-long body come back as a generic `BAD_REQUEST` instead of the stable
 * `BULLETIN_CONTENT_INVALID` code M2-AC18 asks for — and would make the
 * `sync.submitMutations` path (M2.13) reach a *third* copy of the rule.
 *
 * **`type` is validated here** and is the exception that proves the split: it is a
 * closed wire vocabulary, not a product rule with a message, so `z.enum` is the right
 * place for it and rejecting an unknown one before the service is the same answer the
 * service would give. **`expiresAt`'s ISO-8601 *shape* is the same kind of rule** — a
 * string that is not a timestamp is malformed rather than disallowed — while "it must
 * not already have passed" is a product rule and lives in
 * `domain/bulletin-expiry.policy.ts`.
 *
 * `offset: true` accepts `2026-08-24T18:00:00-07:00` as well as a `Z` instant. A phone
 * on playa is not on UTC, and refusing its own offset would push the conversion into
 * every client for no gain — the value is stored as `timestamptz`, which normalises it.
 *
 * **No `authorId`, `userId`, `viewerId`, `actorId`, or `ownerId` field**
 * (ADR-0002:180-181). The author is the resolved actor; a caller asserting authorship
 * would be posting in somebody else's name.
 * `tests/fitness/viewer-id-provenance.fitness.test.ts` walks the built router and fails
 * on any such field.
 */
export const createBulletinInput = z.object({
  type: z.enum(BULLETIN_TYPE),
  title: z.string(),
  body: z.string(),
  loc: z.string().optional(),
  expiresAt: z.iso.datetime({ offset: true }).optional(),
});

export type CreateBulletinInput = z.infer<typeof createBulletinInput>;

/**
 * Turn a validated input into the use case's command fields, ISO string already parsed.
 *
 * **Exported because two transports reach one use case**: the tRPC procedure below and
 * `sync.submitMutations`' `bulletin.create` handler, assembled in
 * `composition/container.ts`. A second copy of this mapping is a second place for the
 * offline path to drift from the online one — which is the whole failure mode ADR-0005
 * requires the two to be indistinguishable against, and which no type could catch
 * because both copies would still compile.
 *
 * The `Date` is built here rather than by a schema `.transform()` so the wire type
 * stays a `string`: `packages/contracts` declares what a client sends, and a transform
 * would make the contract's input type depend on how tRPC infers a piped parser.
 *
 * @returns Everything the command needs except `authorId`, which is the resolved actor
 *   and is never derivable from input.
 */
export function createBulletinCommandFields(
  input: CreateBulletinInput,
): Omit<CreateBulletinCommand, 'authorId'> {
  return {
    type: input.type,
    title: input.title,
    body: input.body,
    loc: input.loc,
    expiresAt: input.expiresAt === undefined ? undefined : new Date(input.expiresAt),
  };
}

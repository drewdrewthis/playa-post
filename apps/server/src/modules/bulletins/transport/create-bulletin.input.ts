import { z } from 'zod';

import { BULLETIN_TYPE } from '../domain/bulletin';

/**
 * `bulletins.create`'s input.
 *
 * **`title` and `body` are `z.string()` and nothing more, deliberately.** Their bounds
 * live in `domain/bulletin-content.policy.ts`, and restating them here would make an
 * over-long body come back as a generic `BAD_REQUEST` instead of the stable
 * `BULLETIN_CONTENT_INVALID` code M2-AC18 asks for — and would make the
 * `sync.submitMutations` path (M2.13) reach a *third* copy of the rule.
 *
 * **`type` is validated here** and is the exception that proves the split: it is a
 * closed wire vocabulary, not a product rule with a message, so `z.enum` is the right
 * place for it and rejecting an unknown one before the service is the same answer the
 * service would give.
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
});

export type CreateBulletinInput = z.infer<typeof createBulletinInput>;

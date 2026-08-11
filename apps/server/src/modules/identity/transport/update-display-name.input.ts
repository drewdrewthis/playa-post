import { z } from 'zod';

import { displayNameSchema } from './display-name';

/**
 * `identity.updateDisplayName`'s input.
 *
 * **One field, and it is not an identifier.** Whose name this is comes from the
 * verified token at the context boundary (`authenticatedProcedure` →
 * `ctx.actor.userId`), so there is no `userId`, `viewerId`, `actorId`, or `ownerId`
 * here and there never may be (ADR-0002:180-181). A caller naming the subject of a
 * rename would be renaming somebody else, which is the impersonation vector R14
 * describes in its purest form — `tests/fitness/viewer-id-provenance.fitness.test.ts`
 * walks the built router and fails on any such field.
 *
 * **`strictObject`, for `decide-intro.input.ts`'s reason applied to a stricter field.**
 * Zod's default object *strips* unknown keys, so a client sending `handle` alongside
 * the name would get a `200` and believe its handle had changed. ADR-0008 rule 4 makes
 * a handle immutable as an anti-impersonation measure and decision D15 records that
 * issue #177 deliberately did not reopen it — so the refusal has to be audible. The
 * same strictness refuses a supplied `userId`/`viewerId`/`actorId`/`ownerId` outright
 * rather than dropping it, which is the loudest possible answer to somebody probing
 * whether this procedure can be aimed at another person.
 *
 * The bound comes from {@link displayNameSchema}, the same schema
 * `identity.completeOnboarding` validates against, so what a person may rename
 * themselves to is exactly what they could have been called at sign-up.
 */
export const updateDisplayNameInput = z.strictObject({
  displayName: displayNameSchema,
});

export type UpdateDisplayNameInput = z.infer<typeof updateDisplayNameInput>;

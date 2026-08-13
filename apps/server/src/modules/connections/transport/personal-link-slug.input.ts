import { z } from 'zod';

/**
 * The input to every procedure that takes a personal-link slug: `personalLink.open` and
 * `requests.send`.
 *
 * One schema for both, because they take the same thing and a second copy is a second place
 * for a field to be added.
 *
 * ⚠ **`slug` is validated as `z.string()` and nothing more**, deliberately. Length and
 * charset are properties of what `domain/personal-link.ts` mints, and restating them here
 * would let a malformed slug come back as a generic `BAD_REQUEST` while a well-formed but
 * unknown one came back as `PERSONAL_LINK_UNAVAILABLE` — which is an oracle for "was that
 * ever the shape of a real link", assembled out of two refusals that each looked reasonable
 * alone. Every string that is not a live slug gets the same answer.
 *
 * **No `userId`, `viewerId`, `actorId`, or `ownerId` field, here or anywhere**
 * (ADR-0002:180-181). Holding the slug is the entire claim; who is holding it comes from the
 * verified access token at the context boundary. In particular there is **no `ownerId`**: a
 * procedure that took one would be a way to request a connection with anybody whose id you
 * could guess, which is the whole thing the link exists to prevent.
 */
export const personalLinkSlugInput = z.object({
  slug: z.string(),
});

export type PersonalLinkSlugInput = z.infer<typeof personalLinkSlugInput>;

import { z } from 'zod';

/**
 * The input to every procedure that takes an invite token: `invitations.open` and
 * `connection.accept`.
 *
 * One schema for both, because they take the same thing and a second copy is a second
 * place for a field to be added. **`token` is validated as `z.string()` and nothing
 * more**, deliberately: length and charset are properties of what
 * `domain/invite-token.ts` mints, and restating them here would let a malformed token
 * come back as a generic `BAD_REQUEST` instead of `INVITATION_UNAVAILABLE` — which is
 * the code M2-AC17 requires, and the one that keeps "never existed" and "already
 * spent" indistinguishable.
 *
 * **No `userId`, `viewerId`, `actorId`, or `ownerId` field, here or anywhere**
 * (ADR-0002:180-181). Holding the token is the entire claim; who is holding it comes
 * from the verified access token at the context boundary.
 */
export const inviteTokenInput = z.object({
  token: z.string(),
});

export type InviteTokenInput = z.infer<typeof inviteTokenInput>;

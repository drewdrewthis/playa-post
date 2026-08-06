import { z } from 'zod';

/**
 * `connections.connection.get`'s input.
 *
 * **`otherUserId`, not `userId`** — see `set-connection-trust.input.ts` for the whole
 * argument. The caller names the *other* party; who they themselves are comes from the
 * verified access token and can never be asserted (ADR-0002:180-181, B14).
 *
 * There is no `connectionId` input. Naming the connection by its ID would make this a
 * lookup that has to be authorized after the fact, and B13's write-path IDOR matrix is
 * the record of how that goes; naming the other person makes membership the lookup
 * itself, so an unauthorized read cannot be phrased.
 */
export const getConnectionInput = z.object({
  otherUserId: z.uuid(),
});

export type GetConnectionInput = z.infer<typeof getConnectionInput>;

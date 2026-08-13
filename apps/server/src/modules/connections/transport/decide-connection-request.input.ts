import { z } from 'zod';

import type { DecideConnectionRequestCommand } from '../application/decide-connection-request.service';
import { CONNECTION_REQUEST_DECISION } from '../domain/connection-request';

/**
 * `connections.requests.decide`'s input — the owner's answer (issue #206).
 *
 * ⚠ **One object with an enum, not a discriminated union.** Both answers take exactly the
 * same fields — the id and the decision — because neither carries content, so a union would
 * be two identical arms pretending to describe a difference. It is the same call
 * `respond-to-intro.input.ts` makes, and for the same reason.
 *
 * ⚠ **`strictObject`, so an unknown key is refused rather than stripped.** Zod's default
 * object silently drops what it does not know, and the field somebody will eventually try to
 * send here is a note — "let me tell them why". Nobody would read it: an acceptance is
 * disclosed by the connection it makes, and a decline is never disclosed at all (ADR-0018
 * D6). Refusing is the honest answer to text written for a reader who does not exist.
 *
 * ⚠ There is no `status` field and must never be one. A caller says what they are doing —
 * accept, or decline — and the server decides what that stores; letting a client post
 * `'accepted'` would be letting them name their own outcome.
 *
 * **No `viewerId`, `userId`, `actorId`, or `ownerId` field** (ADR-0002:180-181). The owner is
 * the resolved actor, compared against the row's stored `owner_id` inside the update — so
 * there is no field here through which somebody could decide a request that is not theirs,
 * and no reply that would tell them whose it is.
 */
export const decideConnectionRequestInput = z.strictObject({
  connectionRequestId: z.uuid(),
  decision: z.enum([CONNECTION_REQUEST_DECISION.accept, CONNECTION_REQUEST_DECISION.decline]),
});

export type DecideConnectionRequestInput = z.infer<typeof decideConnectionRequestInput>;

/**
 * Turn a validated input into the use case's command fields.
 *
 * A function rather than an inline spread, matching this repo's other inputs: the router
 * names one mapping instead of restating the field list, so a field added to the command has
 * one place to be wired rather than two that can drift.
 *
 * @returns Everything the command needs except `actorId`, which is the resolved actor and is
 *   never derivable from input.
 */
export function decideConnectionRequestCommandFields(
  input: DecideConnectionRequestInput,
): Omit<DecideConnectionRequestCommand, 'actorId'> {
  return {
    connectionRequestId: input.connectionRequestId,
    decision: input.decision,
  };
}

import { z } from 'zod';

import { INTRO_DECISION } from '../domain/intro-request';

/**
 * `intros.decide`'s input.
 *
 * `decision` is `z.enum(INTRO_DECISION)` — the domain constant itself, not a hand-written
 * union — matching `moderation-report.input.ts`'s `z.enum(REPORT_REASON)`. The wire
 * vocabulary is then derived from the domain's rather than restated beside it, so the two
 * cannot drift. It is a **closed wire vocabulary**, not a product rule with a message, so
 * a value outside it is rightly a generic `BAD_REQUEST` before any service runs.
 *
 * ⚠ There is no `status` field and must never be one. A caller says what they are doing
 * — pass it on, or decline — and the server decides what that stores; letting a client
 * post `'requested'` would be letting them un-decide somebody else's answer.
 *
 * **No `viewerId`, `userId`, `actorId`, or `ownerId` field** (ADR-0002:180-181). The via
 * is the resolved actor, compared against the row's stored `via_id` inside the update —
 * so there is no field here through which somebody could decide a request that is not
 * theirs, and no reply that would tell them whose it is.
 */
export const decideIntroInput = z.object({
  introRequestId: z.uuid(),
  decision: z.enum(INTRO_DECISION),
});

export type DecideIntroInput = z.infer<typeof decideIntroInput>;

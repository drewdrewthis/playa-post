import { z } from 'zod';

import { REPORT_REASON } from '../domain/report-reason';

/**
 * `moderation.report`'s input — a bulletin, a kind, and an account of what happened.
 *
 * **Its own schema, no longer shared with `moderation.dismiss`.** The two took one
 * input while they took one claim; they no longer do. A report says *this is abuse, and
 * here is why*; a dismissal says *not for me* and must not be able to carry a reason at
 * all (`domain/moderation.repository.ts` splits the write for the same reason). The
 * shared schema's own doc comment named this: "two schemas would be two places for one
 * of them to grow a field the other refuses" — the field arrived, and the refusal is
 * the point.
 *
 * **`reason` is validated here and `detail` is not**, which is the split
 * `create-bulletin.input.ts` establishes: `reason` is a closed wire vocabulary, so
 * `z.enum` is exactly right and rejecting an unknown member before the service is the
 * same answer the service would give. `detail`'s bounds are a *product rule* with a
 * message, so they live in `domain/report-reason.policy.ts` and come back as the stable
 * `REPORT_DETAIL_INVALID` code — restating them here would give a blank account a
 * generic `BAD_REQUEST` and would leave the `sync.submitMutations` path
 * (`bulletin.report` is a declared mutation type) reaching a second copy of the rule.
 *
 * ⚠ `'unspecified'` is **not** accepted. It exists in `app.bulletin_reports.reason` for
 * rows filed before the sheet asked (`LEGACY_REPORT_REASON`), and a request that could
 * write it would let a reporter file a report attributed to nobody's choice.
 *
 * ⚠ **No `viewerId`, `userId`, `actorId`, `reporterId`, or `ownerId` field**
 * (ADR-0002:180-181). The reporter is the resolved actor; a caller naming one would be
 * reporting in somebody else's name.
 * `tests/fitness/viewer-id-provenance.fitness.test.ts` walks the built router and fails
 * on any such field.
 */
export const moderationReportInput = z.object({
  bulletinId: z.uuid(),
  reason: z.enum(REPORT_REASON),
  detail: z.string(),
});

export type ModerationReportInput = z.infer<typeof moderationReportInput>;

import { REPORT_REASON, type ReportBulletinRequest, type ReportReason } from '@playa-post/contracts';

/**
 * Longest account of what happened the report sheet will let someone file.
 *
 * ⚠ **A mirror, not the rule** — the same relationship `compose-bulletin-draft.ts`'s
 * length constants have to `bulletins/domain/bulletin-content.ts`. The rule is
 * `apps/server/src/modules/moderation/domain/report-reason.ts`, which this app cannot
 * import (`no-web-to-server-internals`) and which stays authoritative. The mirror exists
 * so the counter moves as someone types rather than after a round trip; if the two ever
 * drift, the server wins and this form is merely early.
 */
export const REPORT_DETAIL_MAX_LENGTH = 2000;

/**
 * The five chips, in the comp's order, each with the comp's own words.
 *
 * ⚠ **The labels are display copy and the reasons are wire codes, and they are not
 * interchangeable.** `design/Playa Post.dc.html:844` is the source of the labels; the
 * codes come from `@playa-post/contracts`. Rewording a chip is a change to this file
 * alone — sending the label instead of the code would file a report under a category the
 * server refuses.
 */
export const REPORT_REASON_CHOICES: readonly {
  readonly reason: ReportReason;
  readonly label: string;
}[] = [
  { reason: REPORT_REASON.harassment, label: 'Harassment' },
  { reason: REPORT_REASON.scamOrFraud, label: 'Scam or fraud' },
  { reason: REPORT_REASON.impersonation, label: 'Impersonation' },
  { reason: REPORT_REASON.spam, label: 'Spam' },
  { reason: REPORT_REASON.safetyRisk, label: 'Safety risk' },
];

/** What the report sheet holds while it is being filled in. */
export interface ReportAbuseDraft {
  /** `null` until a chip is tapped. The comp preselects none, and neither does this. */
  readonly reason: ReportReason | null;
  /** Free text, untrimmed, as typed. */
  readonly detail: string;
}

/** Why a draft cannot be sent yet. `null` means it can. */
export type ReportDraftIssue = 'no-reason' | 'no-detail' | 'too-long';

/** A fresh draft: nothing chosen, nothing written. */
export function emptyReportAbuseDraft(): ReportAbuseDraft {
  return { reason: null, detail: '' };
}

/**
 * What is stopping this report from being sent.
 *
 * The comp gates Send on both halves — `if (!S.reportType || !S.reportMsg.trim()) return;`
 * (`design/Playa Post.dc.html:848`) — and dims the control until they are there. This
 * returns *which* half so the sheet can say so rather than leaving someone tapping a
 * button that does nothing.
 *
 * The reason is checked before the detail, so a completely empty sheet points at the
 * first thing to do rather than at the box below it.
 */
export function reportDraftIssue(draft: ReportAbuseDraft): ReportDraftIssue | null {
  if (draft.reason === null) {
    return 'no-reason';
  }

  const detail = draft.detail.trim();

  if (detail.length === 0) {
    return 'no-detail';
  }

  return detail.length > REPORT_DETAIL_MAX_LENGTH ? 'too-long' : null;
}

/**
 * Turn a sendable draft into the request `moderation.report` takes.
 *
 * ⚠ **Throws rather than substituting a default reason.** A report filed under a
 * category the reporter did not choose is a false statement attributed to them, and it
 * is the stewards who would act on it. Callers gate on {@link reportDraftIssue} first;
 * this throw is the guarantee that a future caller which forgets fails loudly in
 * development instead of quietly mis-filing.
 *
 * The detail is trimmed here, so what is sent is what the server will store — the same
 * discipline `buildCreateBulletinPayload` follows.
 *
 * @throws {Error} when the draft is not sendable.
 */
export function buildReportPayload(
  bulletinId: string,
  draft: ReportAbuseDraft,
): ReportBulletinRequest {
  const issue = reportDraftIssue(draft);

  if (issue !== null || draft.reason === null) {
    throw new Error(`Cannot build a report payload from a draft that is not sendable: ${String(issue)}`);
  }

  return { bulletinId, reason: draft.reason, detail: draft.detail.trim() };
}

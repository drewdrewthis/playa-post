import { ReportDetailInvalidError } from './moderation.errors';
import { REPORT_DETAIL_MAX_LENGTH } from './report-reason';

/**
 * Accept a reporter's account of what happened, or refuse it.
 *
 * **Required and non-blank**, which is the comp's own rule: Send is inert until both a
 * chip and some words are there (`design/Playa Post.dc.html:848`). A report with a
 * category and no account is a row a steward cannot act on, which is the same reason
 * `validateBulletinContent` refuses an empty title.
 *
 * ⚠ **Here in `domain/`, not in the `moderation.report` input schema.** `bulletin.report`
 * is a declared `sync.submitMutations` mutation type
 * (`modules/sync/domain/mutation-type.ts:22`), so a bound stated only at the tRPC
 * boundary is a bound the offline replay path does not have — the identical reasoning
 * `bulletins/domain/bulletin-content.policy.ts` records for title and body. The schema
 * checks the closed *vocabulary* (a wire concern); this checks the *rule*.
 *
 * Trimmed before it is measured, so leading whitespace can neither disguise an empty
 * account nor consume the budget.
 *
 * @returns The trimmed detail, which is what gets stored — the caller must use this
 *   return value rather than its own input, or the trim is advice instead of a rule.
 * @throws {ReportDetailInvalidError} when it is blank or over the bound.
 */
export function validateReportDetail(detail: string): string {
  const trimmed = detail.trim();

  if (trimmed.length === 0 || trimmed.length > REPORT_DETAIL_MAX_LENGTH) {
    throw new ReportDetailInvalidError(REPORT_DETAIL_MAX_LENGTH);
  }

  return trimmed;
}

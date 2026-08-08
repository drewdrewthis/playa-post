/**
 * What kind of abuse a reporter says they saw.
 *
 * The five members are the comp's five chips (`design/Playa Post.dc.html:844`), in its
 * order. The **keys** are how this codebase names them; the **values** are the wire and
 * storage codes, and they are deliberately not the comp's display copy: "Scam or fraud"
 * is a sentence a designer may reword, and a stored vocabulary that moves when the copy
 * moves rewrites history. The labels live in `apps/web`, beside the sheet that renders
 * them.
 *
 * ⚠ Kebab-case, matching this codebase's other multi-word literal values
 * (`not-onboarded`, `invalid-token`). `snake_case` in this repository means a database
 * *column*, and a value that looks like one invites the confusion.
 */
export const REPORT_REASON = {
  harassment: 'harassment',
  scamOrFraud: 'scam-or-fraud',
  impersonation: 'impersonation',
  spam: 'spam',
  safetyRisk: 'safety-risk',
} as const;

/** One of {@link REPORT_REASON}'s values. */
export type ReportReason = (typeof REPORT_REASON)[keyof typeof REPORT_REASON];

/**
 * What `app.bulletin_reports.reason` holds for a row filed before the sheet asked.
 *
 * ⚠ **Readable, never writable.** It is not a member of {@link REPORT_REASON} and the
 * `moderation.report` input schema will not accept it, so no request can file a report
 * under it — it exists only so the backfill in
 * `20260808094500_add_bulletin_report_reason.sql` could state the truth about rows that
 * predate the question, rather than attributing a category to a reporter who never
 * chose one.
 */
export const LEGACY_REPORT_REASON = 'unspecified';

/**
 * Longest account of what happened a reporter may file.
 *
 * A bound rather than none, because the column is unbounded `text` and the value is
 * attacker-controlled free text. Generous enough that nobody describing a real incident
 * hits it: the comp's own box is three rows and asks them to "be specific".
 */
export const REPORT_DETAIL_MAX_LENGTH = 2000;

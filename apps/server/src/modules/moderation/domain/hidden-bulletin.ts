/**
 * One bulletin one viewer will no longer be shown, and when that became true.
 *
 * **Report and dismissal produce the same thing.** They differ in what they mean to the
 * person — "this is unwanted" versus "not for me" — and in which table records them,
 * but their entire M2 effect is identical: this bulletin leaves this viewer's board and
 * nobody else's. Modelling one outcome rather than two keeps that equality visible; two
 * types would invite a caller to treat them differently, and M5's reason taxonomy is
 * where a real difference is supposed to arrive.
 *
 * ⚠ **There is no author-visible half of this type, and there must never be one.** A
 * report is a private fact about the reporter's own view. M2-AC10/B9 asserts that no
 * response the author can reach carries the reporter's ID, handle, or display name, and
 * the cheapest way to keep that true is for the reporter to appear in exactly one place
 * — `app.bulletin_reports.reporter_id` — that no author-facing read joins.
 */
export interface HiddenBulletin {
  readonly bulletinId: string;
  /** The person for whom it is now hidden. Nobody else is affected. */
  readonly viewerId: string;
  readonly hiddenAt: Date;
}

/**
 * What kind of abuse a reporter says they saw.
 *
 * The five members are the comp's five chips (`design/Playa Post.dc.html:844`), in its
 * order. These are the **wire codes**, not the display copy — "Scam or fraud" is a
 * sentence a designer may reword, and a client that sent its own label would be filing
 * reports under a category the server does not know. The labels live in
 * `apps/web/src/app/moderation/report-abuse-draft.ts`, beside the sheet that renders
 * them.
 *
 * ⚠ Declared here **and** in `apps/server/src/modules/moderation/domain/report-reason.ts`,
 * for the reason ADR-0014 gives and `BULLETIN_TYPE` already demonstrates: this package
 * imports nothing from `apps/server`, so a shared list would invert the workspace
 * layering. `tests/fitness/contracts-api-parity.fitness.test.ts` is what stops the two
 * from drifting — a member added on one side and not the other fails `pnpm typecheck`
 * on the PR that did it.
 *
 * The server's `'unspecified'` legacy value is deliberately absent: it is readable in
 * `app.bulletin_reports` for rows filed before the sheet asked, and no client may ever
 * send it.
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
 * Input of `moderation.dismiss` and `moderation.undismiss` — one bulletin, and no
 * statement about it.
 *
 * One shape for both because they are one decision in two directions, and neither
 * direction says anything about the bulletin the way a report does.
 */
export interface ModerationTargetRequest {
  readonly bulletinId: string;
}

/**
 * Input of `moderation.report`.
 *
 * A separate shape from {@link ModerationTargetRequest} because a dismissal must not be
 * able to carry a reason: dismissing is "not for me" and asserts nothing about the
 * bulletin or its author, while a report is a statement the stewards act on.
 *
 * ⚠ **No reporter field of any spelling.** The reporter is the resolved actor, server
 * side (ADR-0002:180-181).
 */
export interface ReportBulletinRequest {
  readonly bulletinId: string;
  readonly reason: ReportReason;
  /**
   * The reporter's own account of what happened. Required, non-blank after trimming,
   * and at most 2000 characters — refused with `REPORT_DETAIL_INVALID` otherwise.
   *
   * ⚠ Goes only to the stewards. It is never echoed by the response, never returned by
   * any read, and never reaches the reported author (M2-AC10).
   */
  readonly detail: string;
}

/**
 * What comes back when a viewer hides a bulletin.
 *
 * ⚠ **Carries no reporter identity, at any nesting depth** (B9). Report and dismiss
 * return the same shape on purpose: an author must not be able to tell a report from a
 * dismissal, and a client that renders a different affordance for the two would leak
 * that distinction back through the UI.
 *
 * ⚠ The reason and the account are **not** echoed either. The client already knows what
 * it sent, and a field on the response is a field every log, cache, and offline mirror
 * on the way back then carries.
 */
export interface HiddenBulletin {
  readonly bulletinId: string;
  /**
   * When it left this viewer's board. Unchanged by a repeated report or dismissal.
   *
   * ⚠ A dismissal is **not** terminal: the bulletin moves to the viewer's Dismissed
   * category, readable at `bulletins.dismissed`, and `moderation.undismiss` brings it
   * back (#170). A report is not reversible in v1 — withdrawal is M5 — so do not offer
   * one control for both.
   */
  readonly hiddenAt: string;
}

/**
 * What comes back when a viewer un-dismisses a bulletin (#170).
 *
 * **One field, where {@link HiddenBulletin} has two.** There is no `restoredAt`, because
 * un-dismissing deletes the row that held the timestamp — a moment reported here would
 * describe when the server ran, not anything stored.
 *
 * ⚠ **It does not report whether a dismissal was actually there to remove.** The call
 * converges: un-dismissing something never dismissed succeeds and changes nothing, so
 * there is no second case for a client to render.
 *
 * ⚠ **A bulletin can come back un-dismissed and still not appear on the board** — if the
 * viewer also reported it, or if it has since been archived or become unreachable. Re-read
 * `bulletins.board` rather than assuming the card reappears.
 */
export interface RestoredBulletin {
  readonly bulletinId: string;
}

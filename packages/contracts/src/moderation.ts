/** Input of `moderation.report` and `moderation.dismiss`. */
export interface ModerationTargetRequest {
  readonly bulletinId: string;
}

/**
 * What comes back when a viewer hides a bulletin.
 *
 * ⚠ **Carries no reporter identity, at any nesting depth** (B9). Report and dismiss
 * return the same shape on purpose: an author must not be able to tell a report from a
 * dismissal, and a client that renders a different affordance for the two would leak
 * that distinction back through the UI.
 */
export interface HiddenBulletin {
  readonly bulletinId: string;
  /** When it left this viewer's board. Unchanged by a repeated report or dismissal. */
  readonly hiddenAt: string;
}

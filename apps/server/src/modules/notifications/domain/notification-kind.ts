/**
 * Every notification kind a person can switch off — the discriminants of
 * `application/grouped-notification.ts`'s union, as a value.
 *
 * ⚠ **Three copies, kept in lockstep by hand and by test** (ADR-0020 D3): this list, the
 * CHECK on `app.notification_optouts.kind`, and `NOTIFICATION_KINDS` in
 * `packages/contracts` — restated rather than imported, because modules never import
 * contracts. A future kind is added to all three in the PR that adds its union member;
 * the settings integration test round-trips every member of this list through the
 * table, so a copy that drifts fails on the CHECK.
 */
export const NOTIFICATION_KINDS = ['bulletins', 'note'] as const;

/** One member of {@link NOTIFICATION_KINDS}. */
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

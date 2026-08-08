import type { BulletinAuthor } from '@playa-post/contracts';

/**
 * One bulletin as the board screen holds it — the card, the detail sheet, and the
 * route that assembles both read this one shape.
 *
 * `own` and `archived` come from `bulletins.listMine` (the author's read model, the
 * only one carrying `archivedAt`); `author` comes from `bulletins.board` (the eligible
 * viewer's read model, the only one carrying the §6a author card). Neither read model
 * has both, and the board keeps them side by side rather than inventing a merged server
 * type.
 *
 * `loc` is `null` when the bulletin names no place. ⚠ Render nothing for `null` — never
 * a placeholder — and never build a filter from it: it is deliberately absent from the
 * server's `search_document` so that bare text cannot become a way to ask who is camped
 * where (`app.visible_bulletins`).
 */
export interface BoardCardView {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly body: string;
  readonly createdAt: string;
  readonly loc: string | null;
  readonly expiresAt: string | null;
  readonly own: boolean;
  readonly archived: boolean;
  readonly author?: BulletinAuthor;
}

/**
 * Which sheet the board has raised — **at most one, by construction**.
 *
 * Both sheets take the same layer and the same full-column scrim, so two at once would
 * stack a dialog on a dialog with no way to say which Escape belongs to. This was two
 * `useState<string | null>`s and an invariant written in a comment, and the invariant was
 * already false when it was written: raising a note cleared the bulletin and raising a
 * bulletin cleared the note, but the Board/Dismissed toggle cleared only the bulletin, so
 * a note sheet floated over a view that does not list notes.
 *
 * One state fixes that by not being able to express it. There is no pair to keep in sync,
 * no clearing call to forget, and a third sheet added later has one place to be added.
 *
 * ⚠ **The id is not enough on its own, which is why `kind` is here.** A note id and a
 * bulletin id come from two tables and are comparable nowhere (`note-board-items.ts`); a
 * bare string would have to be looked up in both lists, and the first match would win.
 */
export type OpenSheet =
  | { readonly kind: 'none' }
  | { readonly kind: 'bulletin'; readonly id: string }
  | { readonly kind: 'note'; readonly id: string };

/** Nothing raised — the board's initial state, and what every close returns to. */
export const NO_SHEET: OpenSheet = { kind: 'none' };

/** Raise a bulletin's sheet, lowering whatever was up. */
export function bulletinSheet(id: string): OpenSheet {
  return { kind: 'bulletin', id };
}

/** Raise a note's sheet, lowering whatever was up (#176, decision D14). */
export function noteSheet(id: string): OpenSheet {
  return { kind: 'note', id };
}

/**
 * The bulletin to look up, or `null` when what is raised is not a bulletin's sheet.
 *
 * Deliberately an id and not the card: the board looks it up in whichever list is on
 * screen each render, so a bulletin that has left that list — reported, dismissed,
 * refetched away — closes its own sheet instead of describing something no longer there.
 */
export function bulletinSheetId(sheet: OpenSheet): string | null {
  return sheet.kind === 'bulletin' ? sheet.id : null;
}

/** The note to look up, or `null` when what is raised is not a note's sheet. */
export function noteSheetId(sheet: OpenSheet): string | null {
  return sheet.kind === 'note' ? sheet.id : null;
}

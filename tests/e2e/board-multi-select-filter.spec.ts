import { expect, test, type Page } from '@playwright/test';

import { BULLETIN_TYPE, type BulletinType } from '@playa-post/contracts';

/**
 * Selecting more than one type chip at once (issue #171): chips toggle independently,
 * more than one stays pressed together, the board asks the server with `type:a|b`
 * (ADR-0007's own alternation, not a client invention), zero chips means no restriction,
 * and a multi-type `type:` term arriving by URL populates the chips it names.
 *
 * `board-query.unit.test.ts` proves `buildBoardQuery`, `parseBoardQueryState`, and
 * `toggleBoardType` are correct and inverse in isolation. This drives the real chip row
 * in a real browser against three bulletins of three different types, so a match count
 * is a fact about what the server actually returned for a multi-value `type:` term, not
 * an assumption about it.
 *
 * This suite uses a fixture word — `MARKER` below — found nowhere else under
 * `tests/e2e/`: `global-setup.ts` boots one database for the whole `pnpm test:e2e` run,
 * nothing truncates it between spec files, and every file acts as the same
 * `E2E_USER_A_ACCESS_TOKEN`, so every assertion below filters by the marker to find
 * exactly this file's rows regardless of what any other spec has already put on the
 * board.
 *
 * `afterEach` archives the three composed bulletins, for that same shared-database
 * reason: bulletins have no hard delete, only the author-visible archive
 * (`bulletin-detail-sheet.tsx`'s own comment on why the button reads "Remove", not
 * "Delete"). A *filtered* board excludes even its author's own archived bulletins —
 * unlike the unfiltered board, which still shows them, marked
 * (`visible-bulletins.sql`'s `archived_at is null`; `board.tsx`'s doc comment on why the
 * `listMine` union only fires unfiltered) — so an unarchived leftover here would widen a
 * later spec's own chip-filtered count.
 *
 * Writes `docs/engineering/screenshots/m2-board-multi-select-*.png` when
 * `E2E_BOARD_MULTI_SELECT_SCREENSHOT_DIR` is set — an opt-in shape, so a normal run
 * writes nothing and asserts everything.
 *
 * Advisory, like the rest of `test:e2e` (`docs/engineering/l5-plan.md` D2): it is not one
 * of the nine required CI jobs.
 */

/**
 * The comp's phone column, at the size the comp is drawn for. Scoped here so the
 * screenshots below show the comp, not an arbitrary desktop viewport.
 */
test.use({ viewport: { width: 430, height: 860 }, deviceScaleFactor: 2 });

/** Found nowhere else under `tests/e2e/` — see the block comment above for why. */
const MARKER = 'e2e171';

/**
 * Three bulletins of three different postable types, so a `type:a|b` term's match count
 * is provably the union of two types and not a coincidence of one. Each title carries
 * {@link MARKER} so every assertion below can find exactly these three regardless of what
 * any other spec file has already put on this board.
 */
const BULLETINS = [
  { type: BULLETIN_TYPE.offer, title: `${MARKER} spare bike pump`, body: 'Take it, no need to return it.' },
  { type: BULLETIN_TYPE.request, title: `${MARKER} tarp for shade`, body: "Sun's brutal by 2pm." },
  { type: BULLETIN_TYPE.event, title: `${MARKER} sunset chime circle`, body: 'Bring something that rings.' },
] as const;

/** See `vertical-slice-e2e.spec.ts`'s `bootstrapSession` for why this key and this shape. */
async function bootstrapSession(page: Page, accessToken: string): Promise<void> {
  await page.addInitScript((token: string) => {
    (
      globalThis as { localStorage: { setItem(key: string, value: string): void } }
    ).localStorage.setItem('playa-post:e2e-session', JSON.stringify({ accessToken: token }));
    // The one-time welcome popup (#220) stays down: its scrim would swallow clicks
    // mid-flow. Its own coverage is the popup's dedicated evidence spec.
    (
      globalThis as { localStorage: { setItem(key: string, value: string): void } }
    ).localStorage.setItem('playapost-invite-hint-dismissed', 'true');
  }, accessToken);
  await page.goto('/');
}

function requireEnv(name: string): string {
  const value = process.env[name];

  if (value === undefined || value === '') {
    throw new Error(`${name} is not set — tests/e2e/global-setup.ts should have set it`);
  }

  return value;
}

/**
 * Writes one PNG, or nothing when the suite is not being run for its pictures.
 *
 * `animations: 'disabled'` is load-bearing, not tidiness — a default-animated shot
 * photographs the harness (cards mid-fade) instead of the screen.
 */
async function capture(page: Page, name: string): Promise<void> {
  const directory = process.env['E2E_BOARD_MULTI_SELECT_SCREENSHOT_DIR'];

  if (directory === undefined || directory === '') {
    return;
  }

  await page.screenshot({ path: `${directory}/${name}.png`, animations: 'disabled' });
}

/**
 * Writes one bulletin of the acting user's own, through the compose screen.
 *
 * Parameterized by type: this suite needs bulletins of more than one type on the board
 * at once.
 */
async function composeBulletin(
  page: Page,
  bulletin: { readonly type: BulletinType; readonly title: string; readonly body: string },
): Promise<void> {
  await page.getByTestId('compose-bulletin-button').click();
  await page.getByTestId('compose-bulletin-type-select').selectOption(bulletin.type);
  await page.getByTestId('compose-bulletin-title-input').fill(bulletin.title);
  await page.getByTestId('compose-bulletin-body-input').fill(bulletin.body);
  await page.getByTestId('compose-bulletin-submit-button').click();
  // By its title rather than by a card test id: the id carries a server-issued UUID this
  // helper never sees, and the title is what proves *this* bulletin landed rather than
  // that some card is on screen.
  await expect(page.getByText(bulletin.title)).toBeVisible();
}

test.describe('the board filters by more than one type at once', () => {
  test.afterEach(async ({ page }) => {
    await page.goto('/board');

    // The board's own query resolves async — but the unfiltered board can never be
    // legitimately empty here: this test just composed three bulletins of its own.
    // Waiting for any card at all waits out that fetch rather than a genuine absence.
    await page.locator('[data-testid^="board-bulletin-card-"]').first().waitFor();

    const unarchivedMarked = page
      .locator('[data-testid^="board-bulletin-card-"][data-archived="false"]')
      .filter({ hasText: MARKER });

    // Bulletins have no hard delete, only the author-visible archive — drains this
    // file's own three, so a later spec's filtered board never counts one of these
    // among its results.
    for (let remaining = await unarchivedMarked.count(); remaining > 0; remaining -= 1) {
      await unarchivedMarked.first().getByTestId('bulletin-open-button').click();
      await page.getByTestId('bulletin-detail-sheet').getByTestId('bulletin-archive-button').click();
      await expect(unarchivedMarked).toHaveCount(remaining - 1);
    }
  });

  test('chips toggle independently, OR together, arrive by URL, and All clears them', async ({
    page,
  }) => {
    const userAAccessToken = requireEnv('E2E_USER_A_ACCESS_TOKEN');

    await bootstrapSession(page, userAAccessToken);
    await expect(page.getByTestId('graph-home')).toBeVisible();

    for (const bulletin of BULLETINS) {
      await composeBulletin(page, bulletin);
    }

    // 1. A multi-value `type:` term, arriving by URL exactly as a shared link or a
    // browser back/forward would deliver it — settled on first render, no debounce
    // window to race. Proves AC4 and AC6 at their most direct: the term populates two
    // chips together, and the search box carries only the word neither chip could
    // represent (AC6).
    await page.goto(`/board?q=${encodeURIComponent(`type:offer|event ${MARKER}`)}`);
    await expect(page.getByTestId('board-filter-chip-offer')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('board-filter-chip-event')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('board-filter-chip-request')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('board-filter-chip-all')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('board-search-input')).toHaveValue(MARKER);
    await expect(page.getByTestId('board-search-match-count')).toHaveText('2 matches');

    // 2. A clean baseline for the interactive steps below: the marker alone, no `type:`
    // term at all — zero chips selected is "all", not "nothing" (AC3).
    await page.goto(`/board?q=${encodeURIComponent(MARKER)}`);
    await expect(page.getByTestId('board-filter-chip-all')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('board-search-match-count')).toHaveText('3 matches');

    // 3. One chip, clicked — still works exactly as before multi-select existed (AC5).
    await page.getByTestId('board-filter-chip-request').click();
    await expect(page.getByTestId('board-filter-chip-request')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('board-filter-chip-all')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('board-search-match-count')).toHaveText('1 match');

    // 4. A second chip, clicked alongside the first — both stay pressed independently,
    // and the match count is the union of the two types (AC1, AC2). Neither click
    // touched the search box, so the marker is still the only thing in it.
    await page.getByTestId('board-filter-chip-offer').click();
    await expect(page.getByTestId('board-filter-chip-request')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('board-filter-chip-offer')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('board-filter-chip-event')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('board-filter-chip-all')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('board-search-input')).toHaveValue(MARKER);
    await expect(page.getByTestId('board-search-match-count')).toHaveText('2 matches');
    await capture(page, 'm2-board-multi-select-two-chips-selected');

    // 5. All clears a two-type selection the same way it clears one (AC3), and the count
    // goes back to every type this test wrote.
    await page.getByTestId('board-filter-chip-all').click();
    await expect(page.getByTestId('board-filter-chip-all')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('board-filter-chip-offer')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('board-filter-chip-request')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('board-filter-chip-event')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('board-search-match-count')).toHaveText('3 matches');
    await capture(page, 'm2-board-multi-select-zero-chips-is-all');
  });
});

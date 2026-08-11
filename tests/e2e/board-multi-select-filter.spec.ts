import { expect, test, type Page } from '@playwright/test';

import { BULLETIN_TYPE, type BulletinType } from '@playa-post/contracts';

/**
 * Selecting more than one type chip at once (issue #171): chips toggle independently,
 * more than one stays pressed together, the board asks the server with `type:a|b`
 * (ADR-0007's own alternation, not a client invention), zero chips means no restriction,
 * and the round trip through a saved view survives it — the same guarantee
 * `board-saved-view-query.spec.ts` proves for one type, extended to several.
 *
 * `board-query.unit.test.ts` proves `buildBoardQuery`, `parseBoardQueryState`, and
 * `toggleBoardType` are correct and inverse in isolation. This drives the real chip row
 * in a real browser against three bulletins of three different types, so a match count
 * is a fact about what the server actually returned for a multi-value `type:` term, not
 * an assumption about it.
 *
 * See `saved-views-screen.spec.ts` for why this uses a fixture word — `MARKER` below —
 * found nowhere else under `tests/e2e/`: `global-setup.ts` boots one database for the
 * whole `pnpm test:e2e` run, nothing truncates it between spec files, and every file acts
 * as the same `E2E_USER_A_ACCESS_TOKEN`. `afterEach` deletes every saved view the marker
 * matches, because `saved-views-screen.spec.ts:240` asserts this same user's Saved screen
 * is *empty* before that suite seeds its own cards, and spec files run alphabetically in
 * a single worker (`playwright.config.ts`) — `board-multi-select-filter` sorts before
 * `saved-views-screen`, so anything this file leaves behind is exactly what that later
 * assertion would trip over.
 *
 * `afterEach` also archives the three composed bulletins, for the same shared-database
 * reason but a different mechanism: bulletins have no hard delete, only the
 * author-visible archive (`bulletin-detail-sheet.tsx`'s own comment on why the button
 * reads "Remove", not "Delete"). A *filtered* board excludes even its author's own
 * archived bulletins — unlike the unfiltered board, which still shows them, marked
 * (`visible-bulletins.sql`'s `archived_at is null`; `board.tsx`'s doc comment on why the
 * `listMine` union only fires unfiltered) — so an unarchived leftover here would widen a
 * later spec's own chip-filtered count, the same class of cross-file leak the saved-view
 * cleanup exists to prevent.
 *
 * Writes `docs/engineering/screenshots/m2-board-multi-select-*.png` when
 * `E2E_BOARD_MULTI_SELECT_SCREENSHOT_DIR` is set — the same opt-in shape
 * `saved-views-screen.spec.ts` uses, so a normal run writes nothing and asserts
 * everything.
 *
 * Advisory, like the rest of `test:e2e` (`docs/engineering/l5-plan.md` D2): it is not one
 * of the nine required CI jobs.
 */

/**
 * The comp's phone column, at the size the comp is drawn for — see
 * `saved-views-screen.spec.ts` for the citation. Scoped here for the same reason: the
 * screenshots below should show the comp, not an arbitrary desktop viewport.
 */
test.use({ viewport: { width: 430, height: 860 }, deviceScaleFactor: 2 });

/**
 * Found nowhere else under `tests/e2e/` — see the block comment above for why, and for
 * why `afterEach` below deletes every saved view this produces before the test ends.
 *
 * ⚠ **Kept to 6 characters, not the more readable `e2e171multitype`.** A saved view's
 * name is `seedSavedViewName(query)`, which truncates past
 * `SAVED_VIEW_NAME_SEED_MAX_LENGTH` (26) — and the query this suite saves is
 * `type:offer|request ${MARKER}`, already 19 characters before the marker. A longer
 * marker would be cut off the *end* of the saved name, which is exactly where this
 * marker itself lives — breaking both the exact-text assertion below and the `afterEach`
 * cleanup's own `hasText: MARKER` search.
 */
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
 * `animations: 'disabled'` is load-bearing, not tidiness — see `saved-views-screen.spec.ts`'s
 * `capture` for why a default-animated shot photographs the harness instead of the screen.
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
 * Parameterized by type, unlike `saved-views-screen.spec.ts`'s helper of the same shape —
 * this suite needs bulletins of more than one type on the board at once, which that
 * suite's single hardcoded `BULLETIN_TYPE.request` cannot produce.
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

    // The board's own query resolves async too, same hazard as the saved list below —
    // but unlike that list, the unfiltered board can never be legitimately empty here:
    // this test just composed three bulletins of its own. Waiting for any card at all
    // waits out that fetch rather than a genuine absence.
    await page.locator('[data-testid^="board-bulletin-card-"]').first().waitFor();

    const unarchivedMarked = page
      .locator('[data-testid^="board-bulletin-card-"][data-archived="false"]')
      .filter({ hasText: MARKER });

    // Bulletins have no hard delete, only the author-visible archive — drains this
    // file's own three the same way the saved view below is drained, so a later spec's
    // filtered board never counts one of these among its results.
    for (let remaining = await unarchivedMarked.count(); remaining > 0; remaining -= 1) {
      await unarchivedMarked.first().getByTestId('bulletin-open-button').click();
      await page.getByTestId('bulletin-detail-sheet').getByTestId('bulletin-archive-button').click();
      await expect(unarchivedMarked).toHaveCount(remaining - 1);
    }

    await page.goto('/saved');
    const markerCards = page.getByTestId('saved-view').filter({ hasText: MARKER });

    // `views.saved.list` resolves async, and `saved-view` reads 0 while it's in flight —
    // the same count a genuinely empty list would produce. Waiting for a card or the
    // screen's own empty-state copy, whichever the fetch actually produces, is what makes
    // the count read below trustworthy instead of a race against that fetch.
    await page
      .getByTestId('saved-view')
      .first()
      .or(page.getByText('Nothing saved yet. Search the board and save what you find.'))
      .waitFor();

    // Drains whatever the test above left behind, so saved-views-screen.spec.ts's "starts
    // empty" assertion for this same user never has to look at state this file wrote.
    for (let remaining = await markerCards.count(); remaining > 0; remaining -= 1) {
      await markerCards.first().getByTestId('saved-view-delete').click();
      await expect(markerCards).toHaveCount(remaining - 1);
    }
  });

  test('chips toggle independently, OR together, restore from a saved view, and All clears them', async ({
    page,
  }) => {
    const userAAccessToken = requireEnv('E2E_USER_A_ACCESS_TOKEN');

    await bootstrapSession(page, userAAccessToken);
    await expect(page.getByTestId('graph-home')).toBeVisible();

    for (const bulletin of BULLETINS) {
      await composeBulletin(page, bulletin);
    }

    // 1. A multi-value `type:` term, arriving by URL exactly as a saved view or a
    // browser back/forward would deliver it (`board-saved-view-query.spec.ts`'s
    // technique) — settled on first render, no debounce window to race. Proves AC4 and
    // AC6 at their most direct: the term populates two chips together, and the search
    // box carries only the word neither chip could represent (AC6).
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

    // 5. Save it, then reopen it from Saved exactly as a person would — the two chips
    // and the bare search word, recombined from the persisted `type:offer|request` term
    // in canonical order (Request was clicked first, Offer second; the saved text still
    // reads offer before request, matching BULLETIN_TYPE's own declaration order) (AC4).
    await expect(page.getByTestId('board-search-save-button')).toBeEnabled();
    await page.getByTestId('board-search-save-button').click();
    await expect(page.getByTestId('board-save-view-notice')).toHaveText(
      'View saved — find it under Saved',
    );

    await page.goto('/saved');
    const savedCards = page.getByTestId('saved-view').filter({ hasText: MARKER });
    await expect(savedCards).toHaveCount(1);
    await expect(savedCards.getByTestId('saved-view-name')).toHaveText(`type:offer|request ${MARKER}`);
    await savedCards.getByTestId('saved-view-open').click();

    await expect(page.getByTestId('board-filter-chip-offer')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('board-filter-chip-request')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('board-filter-chip-event')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('board-search-input')).toHaveValue(MARKER);
    await expect(page.getByTestId('board-search-match-count')).toHaveText('2 matches');
    await capture(page, 'm2-board-multi-select-reopened-from-saved-view');

    // 6. All clears a two-type selection the same way it clears one (AC3), and the count
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

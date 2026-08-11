import { expect, test, type Page } from '@playwright/test';

/**
 * Opening a saved type-filtered view, then saving again from the reopened board, must
 * reproduce the exact same query — not a `type:` term duplicated onto itself (#173
 * follow-up, PR #181 review round 1).
 *
 * `board-query.unit.test.ts` proves `parseBoardQueryState` and `buildBoardQuery` are
 * inverses in isolation. It cannot prove `board.tsx` actually wires them together: the
 * duplication bug this covers lived exactly in that wiring — `search` and `filter` were
 * being seeded from two independent reads of the same `?q=` text, so a saved
 * `type:request` term ended up counted twice once `buildBoardQuery` recombined them.
 *
 * This asserts the fact a person can observe without any network inspection: the
 * **persisted** query text a saved view carries survives an open-then-resave round trip
 * unchanged. `saved-view-name`'s text is the same `query` value `board.tsx` passes as
 * `sourceText` to the save mutation (`seedSavedViewName(query)`), so reading it back
 * after a real round trip through Postgres is a direct proof of what was actually sent —
 * more direct than decoding the tRPC batch request would have been, and without coupling
 * this test to `httpBatchLink`'s wire format.
 *
 * See `saved-views-screen.spec.ts` for why this uses a fixture word — `MARKER` below —
 * found nowhere else under `tests/e2e/`: `global-setup.ts` boots one database for the
 * whole `pnpm test:e2e` run, nothing truncates it between spec files, and every file
 * acts as the same `E2E_USER_A_ACCESS_TOKEN`. Filtering on that word is what lets this
 * test find *its own* two cards regardless of what any other spec file already saved for
 * this user — and it cuts both ways: the `afterEach` below deletes every card the marker
 * matches once the test ends, because `saved-views-screen.spec.ts:240` asserts this same
 * user's Saved screen is *empty*, before that suite seeds its own cards. Spec files run
 * alphabetically in a single worker (`playwright.config.ts`), `board-` before `saved-`, so
 * anything this file leaves behind is exactly what that later assertion trips over — it
 * did, in this PR's own review round.
 *
 * Advisory, like the rest of `test:e2e` (`docs/engineering/l5-plan.md` D2): it is not one
 * of the nine required CI jobs.
 */

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
 * Found nowhere else under `tests/e2e/` — see the block comment above for why, and for
 * why `afterEach` below deletes every card this produces before the test ends.
 */
const MARKER = 'e2e181nodupe';

test.describe('a saved view carries the same query out as it carried in', () => {
  test.afterEach(async ({ page }) => {
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

    // Drains whatever the test above left behind — 0, 1, or 2 cards, depending how far it
    // got before finishing or failing — so saved-views-screen.spec.ts's "starts empty"
    // assertion for this same user never has to look at state this file wrote.
    for (let remaining = await markerCards.count(); remaining > 0; remaining -= 1) {
      await markerCards.first().getByTestId('saved-view-delete').click();
      await expect(markerCards).toHaveCount(remaining - 1);
    }
  });

  test('reopening and saving again reproduces the original text, not a duplicated type: term', async ({
    page,
  }) => {
    const userAAccessToken = requireEnv('E2E_USER_A_ACCESS_TOKEN');
    const queryText = `type:request ${MARKER}`;

    await bootstrapSession(page, userAAccessToken);
    await expect(page.getByTestId('graph-home')).toBeVisible();

    // 1. Arrive at the filtered board the same way opening a saved view does — a
    // navigation to `/board?q=<source text>`, not typing into the field. That matters:
    // `useDebounced`'s initial value is whatever `search` already is at first render, so
    // a query arriving this way is settled immediately, with no 250ms window to race.
    await page.goto(`/board?q=${encodeURIComponent(queryText)}`);
    await expect(page.getByTestId('board-filter-chip-request')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('board-search-input')).toHaveValue(MARKER);

    await expect(page.getByTestId('board-search-save-button')).toBeEnabled();
    await page.getByTestId('board-search-save-button').click();
    await expect(page.getByTestId('board-save-view-notice')).toHaveText(
      'View saved — find it under Saved',
    );

    // 2. Open it from Saved exactly as a person would, then save again from the reopened
    // state — chip plus search box, recombined by `buildBoardQuery`. If the `type:` term
    // had been left sitting in the search box as well as recovered into the chip, this
    // second save is where it would double up.
    await page.goto('/saved');
    const savedCards = page.getByTestId('saved-view').filter({ hasText: MARKER });
    await expect(savedCards).toHaveCount(1);
    await expect(savedCards.getByTestId('saved-view-name')).toHaveText(queryText);
    await savedCards.getByTestId('saved-view-open').click();

    await expect(page.getByTestId('board-filter-chip-request')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('board-search-input')).toHaveValue(MARKER);

    await expect(page.getByTestId('board-search-save-button')).toBeEnabled();
    await page.getByTestId('board-search-save-button').click();
    await expect(page.getByTestId('board-save-view-notice')).toHaveText(
      'View saved — find it under Saved',
    );

    // 3. The original and the reopened-then-resaved copy read exactly the same text —
    // the query round-tripped losslessly through the chip and back. A duplicated
    // `type:` term would make the second name read `type:request type:request
    // e2e181nodupe` instead, diverging from the first — and would also have degraded
    // the chip's `aria-pressed` in step 2 back to unset once two `type:` values were
    // present, which is exactly how the bug resurrected #173's own symptom on a saved
    // view's *second* open.
    await page.goto('/saved');
    const bothCards = page.getByTestId('saved-view').filter({ hasText: MARKER });
    await expect(bothCards).toHaveCount(2);
    await expect(bothCards.getByTestId('saved-view-name')).toHaveText([queryText, queryText]);
  });
});

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
 * See `saved-views-screen.spec.ts` for why this uses a fixture word — `marker` below —
 * found nowhere else under `tests/e2e/`: `global-setup.ts` boots one database for the
 * whole `pnpm test:e2e` run, nothing truncates it between spec files, and every file
 * acts as the same `E2E_USER_A_ACCESS_TOKEN`. Filtering on that word is what lets this
 * test find *its own* two cards regardless of what any other spec file already saved for
 * this user.
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

test.describe('a saved view carries the same query out as it carried in', () => {
  test('reopening and saving again reproduces the original text, not a duplicated type: term', async ({
    page,
  }) => {
    const userAAccessToken = requireEnv('E2E_USER_A_ACCESS_TOKEN');
    const marker = 'e2e181nodupe';
    const queryText = `type:request ${marker}`;

    await bootstrapSession(page, userAAccessToken);
    await expect(page.getByTestId('graph-home')).toBeVisible();

    // 1. Arrive at the filtered board the same way opening a saved view does — a
    // navigation to `/board?q=<source text>`, not typing into the field. That matters:
    // `useDebounced`'s initial value is whatever `search` already is at first render, so
    // a query arriving this way is settled immediately, with no 250ms window to race.
    await page.goto(`/board?q=${encodeURIComponent(queryText)}`);
    await expect(page.getByTestId('board-filter-chip-request')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('board-search-input')).toHaveValue(marker);

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
    const savedCards = page.getByTestId('saved-view').filter({ hasText: marker });
    await expect(savedCards).toHaveCount(1);
    await expect(savedCards.getByTestId('saved-view-name')).toHaveText(queryText);
    await savedCards.getByTestId('saved-view-open').click();

    await expect(page.getByTestId('board-filter-chip-request')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('board-search-input')).toHaveValue(marker);

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
    const bothCards = page.getByTestId('saved-view').filter({ hasText: marker });
    await expect(bothCards).toHaveCount(2);
    await expect(bothCards.getByTestId('saved-view-name')).toHaveText([queryText, queryText]);
  });
});

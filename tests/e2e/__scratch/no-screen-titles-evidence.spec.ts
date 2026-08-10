import { expect, test, type Page } from '@playwright/test';

/**
 * Evidence for PR #154 / commit 5decb56 ("drop the visible screen titles that were
 * eating vertical space"): the three main-tab screens — graph, board, saved — render
 * without their old visible `<h1>` titles ("Your graph", "The board", "Saved"). Each
 * heading moved to `.sr-only` (`apps/web/src/app/theme/screens.css`): still the
 * screen's one semantic heading, still announced to assistive tech, no visual
 * footprint.
 *
 * ⚠ **`toBeVisible()` cannot detect this `.sr-only`.** `screens.css`'s technique clips
 * to a 1×1px box rather than `display:none` / `visibility:hidden` / a 0×0 box, and
 * Playwright's visibility algorithm is "non-empty bounding box and no
 * `visibility:hidden` in computed style" — a 1×1px box is non-empty, so
 * `getByRole('heading', …)` reads as **visible** by that check. Confirmed empirically
 * against this exact CSS before this spec was written: `isVisible()` → `true`,
 * `boundingBox()` → `{ width: 1, height: 1 }`. The proof below asserts the bounding
 * box directly instead — attached to the DOM, ≤1px on each axis — which is what "no
 * visual footprint" actually means for this technique.
 *
 * Hand-run scratch (gitignored — `.gitignore` and `playwright.config.ts`'s
 * `testIgnore: '**\/__scratch/**'` both keep it out of the swept suite and out of
 * `pnpm test:e2e`). Run directly, through the global build lock:
 *   pnpm exec playwright test tests/e2e/__scratch/no-screen-titles-evidence.spec.ts --project=chromium
 *
 * Writes `docs/engineering/screenshots/no-screen-titles-{graph,board,saved}.png`
 * unconditionally — no `E2E_*_SCREENSHOT_DIR` opt-in gate like the permanent suite's
 * evidence specs (`saved-views-screen.spec.ts`, `welcome.spec.ts`) carry, because this
 * file only ever runs by hand.
 */

/**
 * The comp's phone column, at the size the comp is drawn for — same viewport the
 * other evidence specs use (`report-abuse-sheet.spec.ts`, `saved-views-screen.spec.ts`).
 */
test.use({ viewport: { width: 430, height: 860 }, deviceScaleFactor: 2 });

/** See `saved-views-screen.spec.ts`'s `bootstrapSession` for why this key and this shape. */
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

/** Writes one full-screen PNG into the committed evidence directory, animations held at rest. */
async function capture(page: Page, name: string): Promise<void> {
  await page.screenshot({
    path: `docs/engineering/screenshots/${name}.png`,
    fullPage: true,
    animations: 'disabled',
  });
}

/**
 * Proves a heading is still in the DOM — still the screen's one semantic `<h1>`,
 * still in the accessibility tree — but occupies no visible space. See the module
 * doc comment for why this is a bounding-box assertion and not `.not.toBeVisible()`.
 */
async function expectScreenReaderOnlyHeading(page: Page, name: string): Promise<void> {
  const heading = page.getByRole('heading', { name });
  await expect(heading).toBeAttached();

  const box = await heading.boundingBox();
  if (box === null) {
    throw new Error(`heading "${name}" is attached but reports no bounding box`);
  }
  expect(box.width).toBeLessThanOrEqual(1);
  expect(box.height).toBeLessThanOrEqual(1);
}

test.describe('the three main-tab screens render without their old visible titles', () => {
  test('graph, board, and saved each keep an sr-only heading and show nothing on screen', async ({
    page,
  }) => {
    const accessToken = requireEnv('E2E_USER_A_ACCESS_TOKEN');

    await bootstrapSession(page, accessToken);
    await expect(page.getByTestId('graph-home')).toBeVisible();
    await expectScreenReaderOnlyHeading(page, 'Your graph');
    await capture(page, 'no-screen-titles-graph');

    await page.goto('/board');
    await expect(page.getByTestId('board')).toBeVisible();
    await expectScreenReaderOnlyHeading(page, 'The board');
    await capture(page, 'no-screen-titles-board');

    await page.goto('/saved');
    await expect(page.getByTestId('saved-views')).toBeVisible();
    // Mirrors `saved-views-screen.spec.ts`'s `openSavedScreen`: the screen renders an
    // error paragraph instead of the list when `views.saved.list` refuses, and this is
    // what stops that failure shape from being captured as if it were the design.
    await expect(page.getByTestId('saved-views-error')).toHaveCount(0);
    await expectScreenReaderOnlyHeading(page, 'Saved');
    await capture(page, 'no-screen-titles-saved');
  });
});

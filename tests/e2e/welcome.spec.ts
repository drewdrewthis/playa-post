import { expect, test } from '@playwright/test';

/**
 * The welcome flow (PR #78, extended since): eight network-free steps a first-time
 * visitor walks before sign-in — the comp's three product steps, then the
 * principles intro closing on the eleven-name roll-call.
 *
 * The entry assertion is the routing one — an anonymous visitor who has never seen the
 * flow is sent to `/welcome`, not `/signin` — because that redirect
 * (`auth/require-session.tsx`) is the only thing that makes the flow reachable at all.
 * Both exits stamp `playapost-onboarded` and land on `/signin`, and the replay
 * assertion proves the stamp sticks: the second anonymous visit skips the flow.
 *
 * Writes `docs/engineering/screenshots/m5-welcome-step-{1,3}.png` when
 * `E2E_WELCOME_SCREENSHOT_DIR` is set — the same opt-in shape as
 * `E2E_YOU_SCREENSHOT_DIR` in `you-screen.spec.ts`, so a normal run writes nothing.
 *
 * Advisory, like the rest of `test:e2e` (`docs/engineering/l5-plan.md` D2).
 */
test.describe('the welcome flow', () => {
  test('greets a first-time anonymous visitor, then never again', async ({ page }) => {
    const directory = process.env['E2E_WELCOME_SCREENSHOT_DIR'];

    await page.goto('/');
    await expect(page.getByTestId('welcome')).toBeVisible();
    await expect(page.getByTestId('welcome-next')).toHaveText('Next');

    // The screen is a flex column whose `stretch` default once left-anchored the
    // max-width Next pill; assert it sits on the column's centre axis.
    const column = await page.getByTestId('welcome').boundingBox();
    const nextPill = await page.getByTestId('welcome-next').boundingBox();
    if (column === null || nextPill === null) {
      throw new Error('welcome column or Next pill has no bounding box');
    }
    const offCentreBy = Math.abs(
      nextPill.x + nextPill.width / 2 - (column.x + column.width / 2),
    );
    expect(offCentreBy).toBeLessThanOrEqual(1);
    if (directory !== undefined && directory !== '') {
      await page.screenshot({ path: `${directory}/m5-welcome-step-1.png`, fullPage: true });
    }

    // Seven advances land on the eighth, closing step — the count is pinned here on
    // purpose, so adding or removing a step makes this walk fail loudly.
    for (let advance = 0; advance < 7; advance += 1) {
      await expect(page.getByTestId('welcome-next')).toHaveText('Next');
      await page.getByTestId('welcome-next').click();
      if (directory !== undefined && directory !== '') {
        await page.screenshot({
          path: `${directory}/m5-welcome-step-${advance + 2}.png`,
          fullPage: true,
        });
      }
    }
    await expect(page.getByTestId('welcome-next')).toHaveText('Get started');
    // The closing step carries the full principle roll-call, ten plus consent.
    await expect(page.locator('.welcome__principle')).toHaveCount(11);
    if (directory !== undefined && directory !== '') {
      await page.screenshot({ path: `${directory}/m5-welcome-step-8.png`, fullPage: true });
    }

    await page.getByTestId('welcome-next').click();
    await expect(page).toHaveURL(/\/signin$/);

    // The stamp survives a fresh navigation: the flow never plays twice uninvited.
    await page.goto('/');
    await expect(page).toHaveURL(/\/signin$/);
  });
});

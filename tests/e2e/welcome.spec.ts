import { expect, test, type Page } from '@playwright/test';

/**
 * The welcome flow (PR #78, cut to three steps in #214): three network-free steps a
 * first-time visitor walks before sign-in — the extended-family intro, the eleven-name
 * principle roll-call, and the offers-and-privacy close.
 *
 * The entry assertion is the routing one — an anonymous visitor who has never seen the
 * flow is sent to `/welcome`, not `/signin` — because that redirect
 * (`auth/require-session.tsx`) is the only thing that makes the flow reachable at all.
 * Both exits stamp `playapost-onboarded` and land on `/signin`, and the replay
 * assertion proves the stamp sticks: the second anonymous visit skips the flow.
 *
 * Writes `docs/engineering/screenshots/m5-welcome-step-{1..3}.png` — one per step, the
 * first before the walk and the rest as the walk advances — when
 * `E2E_WELCOME_SCREENSHOT_DIR` is set: the same opt-in shape as
 * `E2E_YOU_SCREENSHOT_DIR` in `you-screen.spec.ts`, so a normal run writes nothing.
 *
 * Advisory, like the rest of `test:e2e` (`docs/engineering/l5-plan.md` D2).
 */

/**
 * Drag horizontally across the welcome screen with the mouse. The route pages on
 * pointer events precisely so a mouse drag and a finger swipe are the same gesture
 * (#214); the 120px travel clears the route's 48px swipe threshold.
 */
async function swipe(page: Page, direction: 'left' | 'right'): Promise<void> {
  const box = await page.getByTestId('welcome').boundingBox();
  if (box === null) {
    throw new Error('welcome screen has no bounding box');
  }
  const y = box.y + box.height / 2;
  const from = box.x + box.width / 2 + (direction === 'left' ? 60 : -60);
  const to = box.x + box.width / 2 + (direction === 'left' ? -60 : 60);
  await page.mouse.move(from, y);
  await page.mouse.down();
  await page.mouse.move(to, y, { steps: 5 });
  await page.mouse.up();
}

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

    // Two advances land on the third, closing step — the count is pinned here on
    // purpose, so adding or removing a step makes this walk fail loudly.
    for (let advance = 0; advance < 2; advance += 1) {
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

    // The middle step carries the full principle roll-call, ten plus consent.
    await swipe(page, 'right');
    await expect(page.getByTestId('welcome-principle')).toHaveCount(11);
    await swipe(page, 'left');
    await expect(page.getByTestId('welcome-next')).toHaveText('Get started');

    await page.getByTestId('welcome-next').click();
    await expect(page).toHaveURL(/\/signin$/);

    // The stamp survives a fresh navigation: the flow never plays twice uninvited.
    await page.goto('/');
    await expect(page).toHaveURL(/\/signin$/);
  });

  test('pages by swipe in both directions, staying put at the edges', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('welcome')).toBeVisible();

    // A swipe back from the first step goes nowhere.
    await swipe(page, 'right');
    await expect(page.getByTestId('welcome-next')).toHaveText('Next');
    await expect(page.getByTestId('welcome-principle')).toHaveCount(0);

    // Two swipes forward walk the whole flow; a third stays on the last step
    // rather than exiting — only the button leaves.
    await swipe(page, 'left');
    await expect(page.getByTestId('welcome-principle')).toHaveCount(11);
    await swipe(page, 'left');
    await expect(page.getByTestId('welcome-next')).toHaveText('Get started');
    await swipe(page, 'left');
    await expect(page.getByTestId('welcome-next')).toHaveText('Get started');
    await expect(page).toHaveURL(/\/welcome$/);

    // Back from the end returns to the roll-call.
    await swipe(page, 'right');
    await expect(page.getByTestId('welcome-principle')).toHaveCount(11);
  });
});

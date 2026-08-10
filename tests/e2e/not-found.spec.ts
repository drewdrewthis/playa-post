import { expect, test } from '@playwright/test';

/**
 * Regression for issue #125: an unknown URL rendered React Router's default developer
 * error screen ("Unexpected Application Error! 404 Not Found 💿 Hey developer 👋") in
 * production — the router had no catch-all route and no `errorElement`.
 *
 * The walk asserts the product now answers an address it does not know in its own
 * voice: an app-styled not-found screen, never the framework's developer screen, with
 * a way back that actually lands somewhere real.
 *
 * Advisory, like the rest of `test:e2e` (`docs/engineering/l5-plan.md` D2).
 */
test.describe('an unknown address', () => {
  test('shows the app-styled not-found screen, never the developer screen', async ({
    page,
  }) => {
    await page.goto('/no-such-place');

    await expect(page.getByTestId('not-found')).toBeVisible();
    await expect(page.locator('body')).not.toContainText('Hey developer');
    await expect(page.locator('body')).not.toContainText('Unexpected Application Error');

    // The way back is a real navigation, not decoration. An anonymous visitor who
    // follows it lands where `/` sends them (welcome or sign-in), not on a blank frame.
    await page.getByTestId('not-found-home').click();
    await expect(page).not.toHaveURL(/no-such-place/);
    await expect(page.getByTestId('not-found')).not.toBeVisible();
  });
});

import { expect, test, type Page } from '@playwright/test';

import {
  BUY_ME_A_COFFEE_URL,
  GITHUB_REPO_URL,
  INFO_PITCH,
} from '../../apps/web/src/app/info/info-copy';

/**
 * The Info screen (issue #216), reached the way a user reaches it: through the tab
 * the Saved Views removal freed (#208).
 *
 * The unit tests already pin the copy's single-sourcing and the anchors' targets;
 * what only a browser can say is that the tab is *in the bar*, that tapping it lands
 * here with the tab lit, and that the support QR keeps its white field in the dark
 * theme (same claim the You screen's QR makes, for the same camera).
 *
 * Writes `docs/engineering/screenshots/m5-info-{dark,light}.png` when
 * `E2E_INFO_SCREENSHOT_DIR` is set — the same opt-in shape as
 * `E2E_YOU_SCREENSHOT_DIR`, so a normal run writes nothing.
 *
 * Advisory, like the rest of `test:e2e` (`docs/engineering/l5-plan.md` D2).
 */

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
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} is not set — tests/e2e/global-setup.ts should have set it`);
  }
  return value;
}

async function capture(page: Page, theme: 'light' | 'dark'): Promise<void> {
  const directory = process.env['E2E_INFO_SCREENSHOT_DIR'];
  if (directory === undefined || directory === '') {
    return;
  }

  await page.screenshot({
    path: `${directory}/m5-info-${theme}.png`,
    fullPage: true,
    animations: 'disabled',
  });
}

test.describe('the Info screen', () => {
  test('is reachable from the tab bar and shows the pitch, the links, and the QR', async ({
    page,
  }) => {
    await bootstrapSession(page, requireEnv('E2E_USER_A_ACCESS_TOKEN'));
    await page.goto('/graph');

    // The tab the removal of Saved Views freed, in the bar between Board and You.
    const infoTab = page.locator('.tab-bar').getByRole('link', { name: 'Info' });
    await expect(infoTab).toBeVisible();
    await infoTab.click();

    await expect(page).toHaveURL(/\/info$/);
    await expect(infoTab).toHaveAttribute('aria-current', 'page');

    const screen = page.getByTestId('info-screen');
    await expect(screen).toBeVisible();
    await expect(screen).toContainText(INFO_PITCH);

    await expect(page.getByTestId('info-github-link')).toHaveAttribute('href', GITHUB_REPO_URL);
    await expect(page.getByTestId('info-coffee-link')).toHaveAttribute(
      'href',
      BUY_ME_A_COFFEE_URL,
    );
    await expect(page.getByTestId('info-replay-welcome')).toBeVisible();

    // Dark is the default (issue #151); the QR's field must stay white under it — a
    // scanner looks for dark modules on a light ground. Same assertion the You screen
    // makes about its own QR, and for the same reason it is asserted, not eyeballed.
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByTestId('info-coffee-qr')).toHaveCSS(
      'background-color',
      'rgb(255, 255, 255)',
    );

    await capture(page, 'dark');

    // One tap moves the preference to 'system', which the harness's pinned
    // `colorScheme: 'light'` resolves to light — the second palette.
    await page.getByTestId('theme-toggle-button').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.getByTestId('info-coffee-qr')).toBeVisible();

    await capture(page, 'light');
  });
});

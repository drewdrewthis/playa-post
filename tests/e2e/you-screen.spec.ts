import { expect, test, type Page } from '@playwright/test';

/**
 * The You screen (issue #49), rendered in **both themes**.
 *
 * ⚠ **This suite exists because "it matches the comp" is otherwise an unfalsifiable
 * claim.** `playwright.config.ts` pins `colorScheme: 'light'` for OS-level emulation —
 * L5's stated scope — but the app's own default is unconditionally dark regardless of
 * the OS (issue #151, superseding #43's light default), so a plain page load renders
 * dark on its own. Every colour on this screen comes from a `--pp-*` token and both
 * token sets are declared, but a token that is declared and a token that is *used* are
 * different facts, and only one of them is visible in a stylesheet. This walks the
 * screen dark first (the default), steps the toggle to 'system' — which the pinned OS
 * colour scheme resolves to light — and walks it again.
 *
 * It writes `docs/engineering/screenshots/m2-you-{light,dark}.png` when
 * `E2E_YOU_SCREENSHOT_DIR` is set — the same opt-in shape
 * `vertical-slice-e2e.spec.ts` uses for `E2E_BOARD_SCREENSHOT_PATH`, so a normal run
 * writes nothing.
 *
 * The **Who-can-see-you dial** (PR #78) is the first of the two standing privacy limits
 * to ship — its default is settled ('sixth', the six-degrees principle) and its cycle is
 * asserted below against the real server. The trust dial remains deferred and asserted
 * nowhere, on purpose.
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
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} is not set — tests/e2e/global-setup.ts should have set it`);
  }
  return value;
}

/**
 * ⚠ **Two shots per theme, and `fullPage` is not what makes the second one necessary.**
 * `.app-column` is a fixed-height flex column that clips so the tab bar stays on the
 * bottom edge, so the screen scrolls *inside* it and `fullPage: true` still stops at the
 * fold — the SYNC section and sign-out are simply not in the first image. Scrolling the
 * screen's own container is the only way to see them.
 */
async function capture(page: Page, theme: 'light' | 'dark'): Promise<void> {
  const directory = process.env['E2E_YOU_SCREENSHOT_DIR'];
  if (directory === undefined || directory === '') {
    return;
  }

  await page.getByTestId('your-profile').evaluate((element) => {
    element.scrollIntoView({ block: 'start' });
  });
  await page.screenshot({ path: `${directory}/m2-you-${theme}.png`, fullPage: true });

  await page.getByTestId('sign-out-button').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${directory}/m2-you-${theme}-lower.png`, fullPage: true });
}

test.describe('the You screen renders in both themes', () => {
  test('shows the profile, the invite, and the sync section', async ({ page }) => {
    await bootstrapSession(page, requireEnv('E2E_USER_A_ACCESS_TOKEN'));
    await page.goto('/you');

    const screen = page.getByTestId('your-profile');
    await expect(screen).toBeVisible();

    await expect(page.getByTestId('profile-counts')).toBeVisible();
    await expect(page.getByTestId('invite-qr')).toBeVisible();
    await expect(page.getByTestId('invite-share-button')).toBeVisible();

    // Dark is the default now (issue #151) — no toggle needed to reach it.
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    // The one element on this screen that must *not* follow the theme: a scanner looks for
    // dark modules on a light field, so a dark-palette QR tile photographs fine and does
    // not read. Asserted rather than screenshotted, because "still white" is the whole
    // claim and a human comparing two images is exactly who would miss it.
    await expect(page.getByTestId('invite-qr')).toHaveCSS('background-color', 'rgb(255, 255, 255)');

    await capture(page, 'dark');

    // One tap moves the preference to 'system', which the harness's pinned
    // `colorScheme: 'light'` resolves to light — the second palette this test needs.
    await page.getByTestId('theme-toggle-button').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    // Everything still on screen after the toggle. A token that resolved to nothing in
    // light would leave an element painted on its own background — which this cannot see,
    // and the screenshot can, which is why both exist.
    await expect(page.getByTestId('profile-counts')).toBeVisible();
    await expect(page.getByTestId('invite-qr')).toBeVisible();
    await expect(page.getByTestId('invite-share-button')).toBeVisible();

    await capture(page, 'light');
  });

  /**
   * The dial round-trips through the real server: every click is an
   * `identity.visibility.set` mutation, and the label the next assertion reads comes
   * from the row the server stored, not from optimistic local state. Four clicks walk
   * the whole scale and land back on the 'sixth' default, so the suite leaves the
   * user's setting exactly where it found it.
   */
  test("cycles the Who-can-see-you dial through the real server and back to 'sixth'", async ({
    page,
  }) => {
    await bootstrapSession(page, requireEnv('E2E_USER_A_ACCESS_TOKEN'));
    await page.goto('/you');

    const dial = page.getByTestId('visibility-dial');
    await expect(dial).toHaveText('UP TO 6TH°');

    const directory = process.env['E2E_YOU_SCREENSHOT_DIR'];
    if (directory !== undefined && directory !== '') {
      await dial.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${directory}/m5-visibility-dial-sixth.png`, fullPage: true });
    }

    for (const label of ['1ST° ONLY', 'UP TO 2ND°', 'UP TO 3RD°', 'UP TO 6TH°']) {
      await dial.click();
      await expect(dial).toHaveText(label);
      // Captured mid-cycle — the end state is 'sixth' again, so a screenshot after
      // the loop would be indistinguishable from `-sixth.png`.
      if (label === 'UP TO 3RD°' && directory !== undefined && directory !== '') {
        await page.screenshot({
          path: `${directory}/m5-visibility-dial-cycled.png`,
          fullPage: true,
        });
      }
    }
  });

  /**
   * The card **stands ready** (#142/#90): QR, link, consent line and share button are all
   * on screen the moment the card is, so this test presses nothing — arriving is the whole
   * interaction, and anything it has to click first would be the step the comp does away
   * with.
   *
   * ⚠ **The share button is never clicked, here or anywhere.** It hands the link to
   * `navigator.share` or the clipboard, neither of which a headless browser grants, and
   * the route swallows both rejections on purpose — so a click would assert nothing while
   * looking like it did. Its label is asserted instead, which is the part a user reads.
   */
  test('stands ready with a real invite link on the CONNECT card', async ({ page }) => {
    await bootstrapSession(page, requireEnv('E2E_USER_A_ACCESS_TOKEN'));
    await page.goto('/you');

    // The QR is the comp's scannable half, and it is the half that cannot be proved by
    // reading text: `react-qr-code` renders nothing at all if the value never arrives.
    await expect(page.getByTestId('invite-qr')).toBeVisible();

    // The link is the whole point of the card: it has to be the route that opens an
    // invite, carrying a token the server actually minted, or it is decoration.
    const link = page.getByTestId('invite-link');
    await expect(link).toBeVisible();
    await expect(link).toContainText('/invite/');

    // Load-bearing copy, not decoration — it is the card's consent promise.
    await expect(page.getByTestId('your-profile')).toContainText(
      'Nothing happens until you both consent.',
    );

    await expect(page.getByTestId('invite-share-button')).toHaveText('Share invite');
  });
});

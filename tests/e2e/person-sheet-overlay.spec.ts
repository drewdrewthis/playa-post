import { expect, test, type Page } from '@playwright/test';

/**
 * The person sheet is an overlay, not a destination.
 *
 * The comp (`design/Playa Post.dc.html`) treats tapping a graph node as *selection* —
 * `sel` opens a bottom sheet over the graph (scrim, CLOSE, trust slider) and closing it
 * puts you exactly where you already were. This suite exists because the first
 * implementation shipped the sheet as a routed page (`/people/:userId`): tapping a
 * circle unmounted the whole graph, which reads as leaving the screen. The assertions
 * here are the ones that distinguish a sheet from a page — the URL does not move, and
 * the graph stays on screen behind the sheet.
 *
 * Advisory, like the rest of `test:e2e` (`docs/engineering/l5-plan.md` D2).
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

test.describe('tapping a graph node', () => {
  test('opens the person sheet over the graph and closes back onto it', async ({ browser }) => {
    const userAAccessToken = requireEnv('E2E_USER_A_ACCESS_TOKEN');
    const userBAccessToken = requireEnv('E2E_USER_B_ACCESS_TOKEN');
    const userBHandle = requireEnv('E2E_USER_B_HANDLE');

    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      // A node only exists once two users are genuinely connected — the proven
      // invite-accept setup from `vertical-slice-e2e.spec.ts`, nothing more.
      await bootstrapSession(pageA, userAAccessToken);
      await expect(pageA.getByTestId('graph-home')).toBeVisible();
      await pageA.getByTestId('invite-create-button').click();
      const inviteToken = (await pageA.getByTestId('invite-token-display').innerText()).trim();
      expect(inviteToken.length).toBeGreaterThan(0);

      await bootstrapSession(pageB, userBAccessToken);
      await pageB.goto(`/invite/${inviteToken}`);
      await pageB.getByTestId('invite-accept-button').click();
      await expect(pageB.getByTestId('connection-accepted-banner')).toBeVisible();

      await pageA.goto('/graph');
      await pageA.getByTestId(`graph-connection-node-${userBHandle}`).click();

      // The sheet is up — and the graph did not go anywhere. These two assertions are
      // the whole point: a routed page would move the URL and unmount `graph-home`.
      await expect(pageA.getByTestId('person-sheet')).toBeVisible();
      await expect(pageA).toHaveURL(/\/graph$/);
      await expect(pageA.getByTestId('graph-home')).toBeVisible();

      // Screenshot only when `E2E_PERSON_SHEET_SCREENSHOT_DIR` is set — the same
      // opt-in shape as `E2E_YOU_SCREENSHOT_DIR`; a normal run writes nothing.
      const directory = process.env['E2E_PERSON_SHEET_SCREENSHOT_DIR'];
      if (directory !== undefined && directory !== '') {
        await pageA.screenshot({
          path: `${directory}/m5-person-sheet-over-graph.png`,
          fullPage: true,
          // Fast-forwards the slide-up so the image shows the settled sheet, not a
          // half-transparent frame of the animation.
          animations: 'disabled',
        });
      }

      // CLOSE puts the viewer back on the graph they never left.
      await pageA.getByTestId('person-sheet-close-button').click();
      await expect(pageA.getByTestId('person-sheet')).not.toBeVisible();
      await expect(pageA).toHaveURL(/\/graph$/);
      await expect(pageA.getByTestId(`graph-connection-node-${userBHandle}`)).toBeVisible();
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});

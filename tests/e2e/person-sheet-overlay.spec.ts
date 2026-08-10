import { expect, test, type Page } from '@playwright/test';

import { mintInviteViaYouScreen } from './support/mint-invite';

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
      const inviteToken = await mintInviteViaYouScreen(pageA);

      await bootstrapSession(pageB, userBAccessToken);
      await pageB.goto(`/invite/${inviteToken}`);
      await pageB.getByTestId('invite-accept-button').click();
      await expect(pageB.getByTestId('connection-accepted-banner')).toBeVisible();

      await pageA.goto('/graph');
      await expect(pageA.getByTestId(`graph-connection-node-${userBHandle}`)).toBeVisible();

      // The canvas is full-bleed (#84): it spans the graph screen's entire width,
      // which the framed-card version it replaced never did (the card sat inside the
      // screen's side padding). Bounding boxes, because this is a question about
      // rendered geometry that no DOM assertion can answer.
      const screenBox = await pageA.getByTestId('graph-home').boundingBox();
      const canvasBox = await pageA.locator('.graph-viz').boundingBox();
      expect(canvasBox?.width).toBe(screenBox?.width);

      // Screenshot of the bare graph screen only when `E2E_GRAPH_SCREENSHOT_DIR` is
      // set — the same opt-in shape as `E2E_YOU_SCREENSHOT_DIR`; a normal run writes
      // nothing. Viewport-sized, not `fullPage`: the claim under review is what fits
      // the shell's own height.
      const graphDirectory = process.env['E2E_GRAPH_SCREENSHOT_DIR'];
      if (graphDirectory !== undefined && graphDirectory !== '') {
        await pageA.screenshot({
          path: `${graphDirectory}/graph-home.png`,
          animations: 'disabled',
        });
      }

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

      // Trust is settable from the sheet (AC3). The sheet's own label is bound to the
      // local draft — it reads 60 the moment the slider moves, saved or not — so the
      // save is proven by what only the server can cause: the graph's TRUSTED count
      // behind the scrim flips to 1 (60 ≥ the threshold of 50) when the save lands and
      // the `graph.list` invalidation refetches.
      await pageA.getByRole('slider', { name: 'Trust' }).fill('60');
      await pageA.getByTestId('person-sheet-save-trust-button').click();
      await expect(pageA.getByTestId('graph-counts')).toHaveText(/· 1 TRUSTED/);

      // And it round-trips: a fresh page load reads trust back from the server, not
      // from anything this tab remembers. This assertion fails if the mutation is
      // neutered — the label on a fresh mount renders the refetched connection.
      await pageA.reload();
      await pageA.getByTestId(`graph-connection-node-${userBHandle}`).click();
      await expect(pageA.getByTestId('person-sheet-trust-value')).toHaveText('Your trust: 60');

      // CLOSE puts the viewer back on the graph they never left.
      await pageA.getByTestId('person-sheet-close-button').click();
      await expect(pageA.getByTestId('person-sheet')).not.toBeVisible();
      await expect(pageA).toHaveURL(/\/graph$/);
      await expect(pageA.getByTestId(`graph-connection-node-${userBHandle}`)).toBeVisible();

      // Focus returns to the node the sheet opened from, so a keyboard user lands on
      // the circle they tapped rather than at the top of the document.
      await expect(pageA.getByTestId(`graph-connection-node-${userBHandle}`)).toBeFocused();

      // Escape is the keyboard way out, and it lands in the same place as CLOSE.
      await pageA.getByTestId(`graph-connection-node-${userBHandle}`).click();
      await expect(pageA.getByTestId('person-sheet')).toBeVisible();
      await pageA.keyboard.press('Escape');
      await expect(pageA.getByTestId('person-sheet')).not.toBeVisible();
      await expect(pageA).toHaveURL(/\/graph$/);
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});

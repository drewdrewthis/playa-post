import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * The intro-request journey, end to end (issue #89, AC27): three real users at the
 * degrees the feature is about — A—B connected, B—C connected, so C sits at exactly
 * degree 2 from A — seeded once in `global-setup.ts` through the real invite
 * procedures.
 *
 * Two walks, and the **decline walk runs first** on purpose. AC27's "C's surface
 * stays empty" is only assertable while C has never been handed anything, and a
 * declined request leaves the pair free to ask again (the partial unique index
 * covers open requests only) — so decline-then-re-ask proves both the privacy
 * invariant and the re-ask freedom in one ordering, where the reverse would leave
 * walk 1's passed-on row sitting on C's surface during walk 2's emptiness check.
 *
 * The two walks also deliberately enter from the two different surfaces that offer
 * the ask: walk 1 from the person sheet on `/graph` (issue #85's entry), walk 2 from
 * the bulletin detail sheet (AC27's named entry).
 *
 * ⚠ One browser context lives at a time. Three concurrent contexts each pulling the
 * whole Vite dev module graph starved Chromium into `ERR_INSUFFICIENT_RESOURCES`
 * (blank pages that never mount). The journey is strictly sequential anyway, so each
 * step opens the acting user's context fresh and closes it before the next.
 *
 * Advisory, like the rest of `test:e2e` (`docs/engineering/l5-plan.md` D2).
 */

/** See `vertical-slice-e2e.spec.ts`'s `bootstrapSession` for why this key and this shape. */
async function withUser<T>(
  browser: Browser,
  accessToken: string,
  run: (page: Page) => Promise<T>,
): Promise<T> {
  const context = await browser.newContext();

  try {
    const page = await context.newPage();
    await page.addInitScript((token: string) => {
      (
        globalThis as { localStorage: { setItem(key: string, value: string): void } }
      ).localStorage.setItem('playa-post:e2e-session', JSON.stringify({ accessToken: token }));
    }, accessToken);
    await page.goto('/');

    return await run(page);
  } finally {
    await context.close();
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];

  if (value === undefined || value === '') {
    throw new Error(`${name} is not set — tests/e2e/global-setup.ts should have set it`);
  }

  return value;
}

/**
 * C never renders by handle on A's graph: disclosure is `full` only along a direct
 * edge, so every degree-2 person is `topology_only` — a "Private connection" dot with
 * no handle testid. That withheld shape is exactly what intros are for (AC22,
 * ADR-0017), so A's walks click the withheld node, not a named one.
 */
async function openPersonSheetOnWithheldNode(page: Page): Promise<void> {
  await page.goto('/graph');
  await expect(page.getByTestId('graph-home')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Private connection' }).click();
  await expect(page.getByTestId('person-sheet')).toBeVisible();
  // Pins the real wire's NOT_CONNECTED refusal rendering as not-connected, not as the
  // error arm — the gap that let every degree-2 sheet ship "That did not load" (#80).
  await expect(page.getByTestId('person-sheet')).toContainText('not connected');
  // And the context block (#85) against the seeded topology: C is two hops from A,
  // through B — derived client-side from the same graph payload that drew the node.
  await expect(page.getByTestId('person-sheet-degree')).toHaveText('2nd degree · via User B');
}

test.describe('asking for an intro through a shared connection', () => {
  test('a decline stays invisible to the target, and a re-ask can then be passed on', async ({
    browser,
  }) => {
    const userAAccessToken = requireEnv('E2E_USER_A_ACCESS_TOKEN');
    const userBAccessToken = requireEnv('E2E_USER_B_ACCESS_TOKEN');
    const userCAccessToken = requireEnv('E2E_USER_C_ACCESS_TOKEN');

    await test.step('walk 1 — A asks from the person sheet on the graph', async () => {
      await withUser(browser, userAAccessToken, async (pageA) => {
        await openPersonSheetOnWithheldNode(pageA);
        await pageA.getByTestId('person-sheet-request-intro-button').click();

        await expect(pageA.getByTestId('intro-sheet')).toBeVisible();
        // Exactly one shared connection exists, so B arrives preselected.
        await expect(pageA.getByTestId('intro-sheet-via-chip')).toHaveCount(1);
        await pageA.getByTestId('intro-sheet-note-input').fill('We met at the trash fence?');
        await pageA.getByTestId('intro-sheet-send-button').click();
        await expect(pageA.getByTestId('intro-sheet-sent')).toBeVisible();
      });
    });

    await test.step('walk 1 — B declines from the graph inbox', async () => {
      await withUser(browser, userBAccessToken, async (pageB) => {
        await pageB.goto('/graph');
        await expect(pageB.getByTestId('graph-home')).toBeVisible({ timeout: 20_000 });
        const viaRow = pageB.getByTestId('intro-inbox-via-row');
        await expect(viaRow).toBeVisible({ timeout: 15_000 });
        await expect(viaRow).toContainText('User A');
        await viaRow.getByTestId('intro-decline-button').click();
        await expect(pageB.getByTestId('intro-inbox-via-row')).toHaveCount(0);
      });
    });

    await test.step('walk 1 — the decline never reaches C, and A reads only "not passed on"', async () => {
      // The privacy invariant (ADR-0017): a declined ask is invisible to the target
      // forever. C's inbox renders nothing at all — not an empty shell.
      await withUser(browser, userCAccessToken, async (pageC) => {
        await pageC.goto('/graph');
        await expect(pageC.getByTestId('graph-home')).toBeVisible({ timeout: 20_000 });
        await expect(pageC.getByTestId('intro-inbox')).toHaveCount(0);
        await expect(pageC.getByTestId('intro-inbox-target-row')).toHaveCount(0);
      });

      await withUser(browser, userAAccessToken, async (pageA) => {
        await openPersonSheetOnWithheldNode(pageA);
        const standing = pageA.getByTestId('person-sheet-intro-standing');
        await expect(standing).toContainText('not passed on', { timeout: 15_000 });
        // No reason, no "declined", and no re-ask control beyond the standing line —
        // the requester learns the outcome and nothing about why.
        await expect(standing).not.toContainText(/declin|reason|why/i);
      });
    });

    await test.step('walk 2 — C posts a bulletin, A re-asks from its detail sheet', async () => {
      await withUser(browser, userCAccessToken, async (pageC) => {
        await pageC.getByTestId('compose-bulletin-button').click();
        await pageC.getByTestId('compose-bulletin-type-select').selectOption('request');
        await pageC.getByTestId('compose-bulletin-title-input').fill('Spare bike wheel out here?');
        await pageC
          .getByTestId('compose-bulletin-body-input')
          .fill('Mine folded at the 9:00 plaza — anyone have a 26-inch to lend?');
        await pageC.getByTestId('compose-bulletin-submit-button').click();
        // The composer lands back on the board; the new card proves the post persisted.
        await expect(pageC.getByText('Spare bike wheel out here?')).toBeVisible({
          timeout: 15_000,
        });
      });

      await withUser(browser, userAAccessToken, async (pageA) => {
        await pageA.goto('/board');
        const card = pageA
          .locator('[data-testid^="board-bulletin-card-"]')
          .filter({ hasText: 'Spare bike wheel out here?' });
        await expect(card).toBeVisible({ timeout: 15_000 });
        await card.getByTestId('bulletin-open-button').click();
        await expect(pageA.getByTestId('bulletin-detail-sheet')).toBeVisible();
        await pageA.getByTestId('bulletin-detail-request-intro-button').click();

        await expect(pageA.getByTestId('intro-sheet')).toBeVisible();
        await pageA.getByTestId('intro-sheet-note-input').fill('I have that wheel — intro us?');
        await pageA.getByTestId('intro-sheet-send-button').click();
        await expect(pageA.getByTestId('intro-sheet-sent')).toBeVisible();

        // And the person sheet reads the open ask back: pending, via B by name.
        await openPersonSheetOnWithheldNode(pageA);
        await expect(pageA.getByTestId('person-sheet-intro-standing')).toContainText(
          'Intro pending via User B',
          { timeout: 15_000 },
        );
      });
    });

    await test.step('walk 2 — B passes it on', async () => {
      await withUser(browser, userBAccessToken, async (pageB) => {
        await pageB.goto('/graph');
        await expect(pageB.getByTestId('graph-home')).toBeVisible({ timeout: 20_000 });
        const viaRow = pageB.getByTestId('intro-inbox-via-row');
        await expect(viaRow).toBeVisible({ timeout: 15_000 });
        await viaRow.getByTestId('intro-pass-on-button').click();
        await expect(pageB.getByTestId('intro-inbox-via-row')).toHaveCount(0);
      });
    });

    await test.step('walk 2 — C now sees who asked, and the note', async () => {
      await withUser(browser, userCAccessToken, async (pageC) => {
        await pageC.goto('/graph');
        await expect(pageC.getByTestId('graph-home')).toBeVisible({ timeout: 20_000 });
        const targetRow = pageC.getByTestId('intro-inbox-target-row');
        await expect(targetRow).toBeVisible({ timeout: 15_000 });
        // The consent inversion (ADR-0017): asking is consent, so once passed on the
        // target reads the requester's name and note even where A's own visibility
        // setting would otherwise withhold them.
        await expect(targetRow).toContainText('User A');
        await expect(targetRow).toContainText('I have that wheel — intro us?');
      });
    });
  });
});

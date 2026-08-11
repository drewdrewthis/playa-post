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
 * Issue #175 gave walk 2 its second half: **passing an intro on requires a note of the
 * via's own**, so B's decision is now two presses and C's row carries two notes by two
 * people. Walk 1's decline is untouched — a decline carries no note and never will.
 *
 * Issue #166 gave walk 2 its third: **C accepts, and the introduction becomes a
 * connection.** That last step is the only one in this file that is not synchronous —
 * accepting writes the answer and an `IntroAccepted` event in one transaction, and
 * `modules/connections` forms the edge from that event on the drainer's next round
 * (decision D12). So the assertion polls a reloaded graph rather than reading it once:
 * a single read would be racing a delivery the design deliberately does not make
 * immediate.
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
  // `toContainText`, matching line 74's looser style: this helper runs under every
  // walk, and pinning the exact separator or seed name here would redden them all
  // over a copy tweak.
  await expect(page.getByTestId('person-sheet-degree')).toContainText('2nd degree');
  await expect(page.getByTestId('person-sheet-degree')).toContainText('via User B');
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

    await test.step('walk 2 — B passes it on, with a note of their own', async () => {
      await withUser(browser, userBAccessToken, async (pageB) => {
        await pageB.goto('/graph');
        await expect(pageB.getByTestId('graph-home')).toBeVisible({ timeout: 20_000 });
        const viaRow = pageB.getByTestId('intro-inbox-via-row');
        await expect(viaRow).toBeVisible({ timeout: 15_000 });

        // ⚠ Pass on opens the field; it does not decide (#175, decision D11). The row is
        // still here afterwards, which is the browser-level proof that the first press
        // sent nothing — the walk below only works because the second press does.
        await viaRow.getByTestId('intro-pass-on-button').click();
        await expect(viaRow.getByTestId('intro-via-note-input')).toBeVisible();
        await expect(pageB.getByTestId('intro-inbox-via-row')).toHaveCount(1);

        await viaRow
          .getByTestId('intro-via-note-input')
          .fill('A fixes bikes and C needs one fixed. Worth ten minutes.');
        await viaRow.getByTestId('intro-pass-on-submit-button').click();
        await expect(pageB.getByTestId('intro-inbox-via-row')).toHaveCount(0);
      });
    });

    await test.step('walk 2 — C reads both notes, each under its own author', async () => {
      await withUser(browser, userCAccessToken, async (pageC) => {
        await pageC.goto('/graph');
        await expect(pageC.getByTestId('graph-home')).toBeVisible({ timeout: 20_000 });
        const targetRow = pageC.getByTestId('intro-inbox-target-row');
        await expect(targetRow).toBeVisible({ timeout: 15_000 });
        // The consent inversion (ADR-0017): asking is consent, so once passed on the
        // target reads the requester's name and note even where A's own visibility
        // setting would otherwise withhold them.
        await expect(targetRow).toContainText('User A');
        await expect(targetRow.getByTestId('intro-inbox-requester-note')).toContainText(
          'I have that wheel — intro us?',
        );
        // ⚠ And the second half (#175): the via's vouch, under the via's own name.
        // Passing an intro on is consent to be named as its via, so B is on the row
        // beside the words B wrote.
        await expect(targetRow).toContainText('User B');
        await expect(targetRow.getByTestId('intro-inbox-via-note')).toContainText(
          'A fixes bikes and C needs one fixed.',
        );
      });
    });

    await test.step('walk 2 — C accepts, and the introduction becomes a connection', async () => {
      const userAHandle = requireEnv('E2E_USER_A_HANDLE');

      await withUser(browser, userCAccessToken, async (pageC) => {
        await pageC.goto('/graph');
        await expect(pageC.getByTestId('graph-home')).toBeVisible({ timeout: 20_000 });

        // ⚠ Before the press: A is not on C's graph at all. The two have never been
        // connected, and C's whole reason for having a row to answer is that A was
        // disclosed by the introduction rather than by the graph.
        await expect(pageC.getByTestId(`graph-connection-node-${userAHandle}`)).toHaveCount(0);

        const targetRow = pageC.getByTestId('intro-inbox-target-row');
        await expect(targetRow).toBeVisible({ timeout: 15_000 });
        await targetRow.getByTestId('intro-accept-button').click();

        // The row leaves the inbox — an inbox is what is waiting on you — and the live
        // region says so, because a card that vanishes under the finger with nothing said
        // reads as a failure.
        await expect(pageC.getByTestId('intro-inbox-target-row')).toHaveCount(0);
        await expect(pageC.getByTestId('intro-inbox-confirmation')).toContainText(
          'being connected',
        );
      });

      await withUser(browser, userCAccessToken, async (pageC) => {
        // ⚠ **Polled with a reload, and the poll is the point.** The edge is written by
        // the outbox drainer's own round (decision D12), so this is the one assertion in
        // the file that has to outlast a delivery. `toPass` re-runs the whole reload, which
        // is what a person refreshing their graph would do.
        await expect(async () => {
          await pageC.goto('/graph');
          await expect(pageC.getByTestId('graph-home')).toBeVisible({ timeout: 20_000 });
          await expect(
            pageC.getByTestId(`graph-connection-node-${userAHandle}`),
          ).toBeVisible({ timeout: 2_000 });
        }).toPass({ timeout: 30_000 });

        // A direct edge, not merely a node: C is now connected to A rather than seeing
        // them at a distance, which is the whole of what accepting bought.
        await expect(pageC.getByTestId(`graph-connection-edge-${userAHandle}`)).toBeVisible();
      });
    });
  });
});

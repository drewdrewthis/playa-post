import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * The bell badge drops when the panel is opened, and comes back when something new
 * arrives (issue #178) — the whole journey, in a real browser, against the real server.
 *
 * **Four facts, and the fourth is the one worth the browser.** That opening the panel
 * clears the badge, that a later arrival raises it again, that a repeat open clears it
 * again — those are `list-notifications-seen.unit.test.ts`'s and
 * `notification-seen.integration.test.ts`'s, proven there against pinned clocks and a real
 * Postgres. What only this file can prove is that **seen and dismissed stayed different
 * acts all the way to the pixels**: the panel body is unchanged by an open, every row is
 * still waiting, and the `✕` is still the only thing that moves one into Dismissed.
 *
 * **Notes, not Notify Me bulletins, and the reason is the clock.** A `NotifyMeMatched`
 * notification cannot be delivered until its 60-second grouping window has fully elapsed
 * (M2-AC7, a domain constant no harness may shorten) — `vertical-slice-e2e.spec.ts` pays
 * 90 s for exactly one. This journey needs *three* notifications at two different moments,
 * and a `NotePinned` event is delivered by the ordinary outbox drainer with no window at
 * all, so each arrives in a second or two.
 *
 * ⚠ **User C is the reader, and the choice is a cleanup decision rather than a
 * preference.** `global-setup.ts` boots one database for the whole `pnpm test:e2e` run,
 * nothing truncates it between spec files, and spec files run alphabetically in a single
 * worker (`playwright.config.ts`) — so whatever a file leaves behind belongs to every file
 * that sorts after it. A pinned note has **no take-down at all**: decision D6's corollary
 * gives `app.notes` neither an `archived_at` nor a delete, so unlike the bulletins
 * `board-multi-select-filter.spec.ts` archives in its `afterEach`, the three
 * notes below genuinely cannot be removed. The honest answer is therefore to write them
 * where nothing later reads them: `intro-request.spec.ts` is the only other file that acts
 * as C, and `intro-request` sorts before `notification-seen-badge`. Pinning to **B** would
 * have been the wrong choice for the same reason in reverse — `vertical-slice-e2e.spec.ts`
 * runs later and waits, as B, for its own notification to be the one that appears.
 *
 * What this file *can* clean up, it does: `afterEach` dismisses every notification C is
 * holding, so the bell is quiet and `app.notification_dismissals` carries the record —
 * marking, never deleting, the same "no hard deletes" discipline the other specs follow.
 *
 * Writes `docs/engineering/screenshots/m2-notification-seen-*.png` when
 * `E2E_NOTIFICATION_SEEN_SCREENSHOT_DIR` is set — the same opt-in shape
 * `board-multi-select-filter.spec.ts` uses, so a normal run writes nothing and asserts
 * everything.
 *
 * Advisory, like the rest of `test:e2e` (`docs/engineering/l5-plan.md` D2): it is not one
 * of the nine required CI jobs.
 */

/**
 * The comp's phone column, at the size the comp is drawn for. Scoped here so the
 * screenshots below show the comp's bell, not an arbitrary desktop viewport.
 */
test.use({ viewport: { width: 430, height: 860 }, deviceScaleFactor: 2 });

/**
 * Rides in each note's body so a leftover `app.notes` row is traceable to this file.
 *
 * ⚠ **It is deliberately not an assertion target.** A note notification carries the note's
 * identifier and nothing else — no body, no author (M2-AC5, decision D6) — so this string
 * can never appear in the panel, and a test that looked for it there would be asserting
 * the privacy bug rather than the feature.
 */
const MARKER = 'e2e178';

/**
 * ⚠ One browser context lives at a time — `intro-request.spec.ts`'s constraint, for its
 * reason: three concurrent contexts each pulling the whole Vite dev module graph starved
 * Chromium into `ERR_INSUFFICIENT_RESOURCES`. This journey is strictly sequential anyway.
 *
 * See `vertical-slice-e2e.spec.ts`'s `bootstrapSession` for why this key and this shape.
 */
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
 * Writes one PNG, or nothing when the suite is not being run for its pictures.
 *
 * `animations: 'disabled'` is load-bearing, not tidiness — a default-animated shot
 * photographs the harness instead of the screen.
 */
async function capture(page: Page, name: string): Promise<void> {
  const directory = process.env['E2E_NOTIFICATION_SEEN_SCREENSHOT_DIR'];

  if (directory === undefined || directory === '') {
    return;
  }

  await page.screenshot({ path: `${directory}/${name}.png`, animations: 'disabled' });
}

/**
 * Pins one note from the acting user to `recipientHandle`, through the real screens.
 *
 * The person sheet's primary action is the composer's only entrance — `pinNoteHref` builds
 * `/board/new?noteTo=<id>` from an identifier this helper never sees, so walking the graph
 * is also what proves the recipient the server writes to is the one the reader clicked.
 */
async function pinNote(page: Page, recipientHandle: string, body: string): Promise<void> {
  await page.goto('/graph');
  await expect(page.getByTestId('graph-home')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId(`graph-connection-node-${recipientHandle}`).click();
  await expect(page.getByTestId('person-sheet')).toBeVisible();

  await page.getByTestId('person-sheet-pin-note-link').click();
  await expect(page.getByTestId('compose-note')).toBeVisible();
  await page.getByTestId('compose-note-body-input').fill(body);
  await page.getByTestId('compose-note-submit-button').click();
  // The toast is the composer's own "it worked", raised only once `pin-note-submit.ts`
  // reports the queued write settled — which is what makes the wait below a wait for the
  // *delivery*, not for the write.
  await expect(page.getByTestId('compose-note-toast')).toBeVisible();
}

/**
 * Waits for the bell to read exactly `count`, reloading between attempts.
 *
 * ⚠ **The reload is not impatience, it is the only thing that can refresh a closed
 * panel.** `useGroupedNotifications` polls *while the panel is open* and not otherwise
 * (`notifications-query.ts`), so a badge rendered before the outbox drainer delivered
 * would sit at its old value forever with the panel shut. A person meets this as "open the
 * app and the badge is there"; the reload is that, repeated until the drainer has run.
 */
async function expectBadge(page: Page, count: number): Promise<void> {
  await expect(async () => {
    await page.reload();
    await expect(page.getByTestId('notifications-unseen-count')).toHaveText(String(count));
  }).toPass({ timeout: 30_000 });
}

test.describe('the bell badge clears when the panel is opened', () => {
  test.beforeEach(async ({ browser }) => {
    // Since #209 every bulletin C can see arrives as a notification by default, so
    // whatever bulletins the specs before this one posted may be sitting on C's bell —
    // and this journey's exact badge counts only mean anything from a quiet start.
    // Two acts, through the real screens: retire anything already delivered, and switch
    // Bulletins off so nothing new lands mid-journey. Notes — the kind this file is
    // about — stay on, and `afterEach` switches Bulletins back.
    await withUser(browser, requireEnv('E2E_USER_C_ACCESS_TOKEN'), async (page) => {
      await page.getByTestId('notifications-bell-button').click();
      await expect(page.getByTestId('notifications-panel')).toBeVisible();

      const clearAll = page.getByTestId('notifications-clear-all');
      if (await clearAll.isVisible()) {
        await clearAll.click();
        await expect(clearAll).toBeHidden();
      }

      await page.getByTestId('notification-settings-toggle').click();
      const bulletins = page.getByTestId('notification-setting-bulletins');
      await expect(bulletins).toBeVisible();
      if ((await bulletins.getAttribute('aria-checked')) === 'true') {
        await bulletins.click();
        await expect(bulletins).toHaveAttribute('aria-checked', 'false');
      }
    });
  });

  test.afterEach(async ({ browser }) => {
    // Everything this file can retire, it retires. The notes themselves cannot be — see
    // the block comment above — but the notifications pointing at them can, so the bell C
    // hands to the rest of the run is quiet. Dismissing marks rather than deletes, which
    // is the only "cleanup" this product's model offers for a notification.
    await withUser(browser, requireEnv('E2E_USER_C_ACCESS_TOKEN'), async (page) => {
      await page.getByTestId('notifications-bell-button').click();
      await expect(page.getByTestId('notifications-panel')).toBeVisible();

      const clearAll = page.getByTestId('notifications-clear-all');

      // Absent when nothing is unread, which is the state a passing run may already be in
      // if the test dismissed its own rows — so this is a conditional, not a wait.
      if (await clearAll.isVisible()) {
        await clearAll.click();
        await expect(clearAll).toBeHidden();
      }

      // Hand the rest of the run the defaults back: Bulletins on again (see beforeEach).
      await page.getByTestId('notification-settings-toggle').click();
      const bulletins = page.getByTestId('notification-setting-bulletins');
      await expect(bulletins).toBeVisible();
      if ((await bulletins.getAttribute('aria-checked')) === 'false') {
        await bulletins.click();
        await expect(bulletins).toHaveAttribute('aria-checked', 'true');
      }
    });
  });

  test('opening the panel drops the badge without dismissing anything, and a new note raises it again', async ({
    browser,
  }) => {
    const userBAccessToken = requireEnv('E2E_USER_B_ACCESS_TOKEN');
    const userCAccessToken = requireEnv('E2E_USER_C_ACCESS_TOKEN');
    const userCHandle = requireEnv('E2E_USER_C_HANDLE');

    await test.step('B pins two notes to C, so C has something to be notified about', async () => {
      await withUser(browser, userBAccessToken, async (pageB) => {
        await pinNote(pageB, userCHandle, `${MARKER} the shade structure needs a hand at dawn`);
        await pinNote(pageB, userCHandle, `${MARKER} bring the good coffee, ours is gone`);
      });
    });

    await test.step("C's bell carries the count before the panel is ever opened", async () => {
      await withUser(browser, userCAccessToken, async (pageC) => {
        // Two notes are two notifications: a note is one deliberate act aimed at one
        // person and is never grouped, however close together two arrive.
        await expectBadge(pageC, 2);
        await expect(pageC.getByTestId('notifications-bell-button')).toHaveAttribute(
          'aria-label',
          'Notifications, 2 new',
        );
        await capture(pageC, 'm2-notification-seen-badge-with-count');
      });
    });

    await test.step('opening the panel clears the badge and moves nothing (AC1, AC2, AC4)', async () => {
      await withUser(browser, userCAccessToken, async (pageC) => {
        await expectBadge(pageC, 2);

        await pageC.getByTestId('notifications-bell-button').click();
        await expect(pageC.getByTestId('notifications-panel')).toBeVisible();

        // ⚠ The load-bearing pair. The badge goes — and the two rows are still in the
        // panel's active section, still marked unread, with no Dismissed section beneath
        // them. An implementation that cleared the badge by dismissing would pass the
        // first of these three and fail the other two.
        await expect(pageC.getByTestId('notifications-unseen-count')).toHaveCount(0);
        // Scoped to the active list: the rows `beforeEach` retired sit in the Dismissed
        // section below, and counting them here would blur exactly the line this step
        // exists to draw.
        const activeRows = pageC.locator(
          '.notifications__body > .notifications__list [data-testid="notification-grouped-item"]',
        );
        await expect(activeRows).toHaveCount(2);
        await expect(
          pageC.locator(
            '.notifications__body > .notifications__list [data-testid="notification-grouped-item"][data-unread="true"]',
          ),
        ).toHaveCount(2);
        // Opening moved nothing into Dismissed: whatever `beforeEach` retired is all
        // that is there — the count is unchanged by the open.
        const dismissedRows = pageC.locator(
          '[data-testid="notifications-dismissed"] [data-testid="notification-grouped-item"]',
        );
        const dismissedBefore = await dismissedRows.count();

        // Closed before the shot: the panel is a full-column takeover (#51) and covers the
        // chrome the bell lives in, so the cleared badge is only photographable from the
        // screen behind it — which is also where a person sees it.
        await pageC.getByRole('button', { name: 'Close notifications' }).click();
        await expect(pageC.getByTestId('notifications-panel')).toHaveCount(0);
        await expect(pageC.getByTestId('notifications-unseen-count')).toHaveCount(0);
        await expect(pageC.getByTestId('notifications-bell-button')).toHaveAttribute(
          'aria-label',
          'Notifications',
        );
        await capture(pageC, 'm2-notification-seen-badge-cleared-after-open');

        // Dismiss is still its own act, and still the only one that moves a row (AC4).
        await pageC.getByTestId('notifications-bell-button').click();
        await pageC.getByTestId('notification-dismiss-button').first().click();
        await expect(
          pageC.locator('[data-testid="notification-grouped-item"][data-unread="true"]'),
        ).toHaveCount(1);
        await expect(pageC.getByTestId('notifications-dismissed')).toBeVisible();
        // …and the `✕` moved exactly one row there — the open above moved none.
        await expect(dismissedRows).toHaveCount(dismissedBefore + 1);
        // Dismissing something already seen cannot lower a badge that is already empty —
        // stated so a future badge that counted `unread` again would be caught here too.
        await expect(pageC.getByTestId('notifications-unseen-count')).toHaveCount(0);
      });
    });

    await test.step('a note that arrives after the last open raises the badge again (AC3)', async () => {
      await withUser(browser, userBAccessToken, async (pageB) => {
        await pinNote(pageB, userCHandle, `${MARKER} the dawn shift moved an hour earlier`);
      });

      await withUser(browser, userCAccessToken, async (pageC) => {
        // Exactly one, and that is the crisp end of this journey: everything older is
        // seen, so the badge counts only what happened since C last looked — not "one
        // undismissed thing", which would have read 2.
        await expectBadge(pageC, 1);
        await expect(pageC.getByTestId('notifications-bell-button')).toHaveAttribute(
          'aria-label',
          'Notifications, 1 new',
        );
        await capture(pageC, 'm2-notification-seen-badge-elevated-after-new-arrival');

        // And a second open clears it again, which is what makes the badge a live signal
        // rather than a one-shot one.
        await pageC.getByTestId('notifications-bell-button').click();
        await expect(pageC.getByTestId('notifications-panel')).toBeVisible();
        await expect(pageC.getByTestId('notifications-unseen-count')).toHaveCount(0);
      });
    });
  });
});

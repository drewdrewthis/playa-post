import { expect, test, type Page } from '@playwright/test';

import { BULLETIN_TYPE, REPORT_REASON } from '@playa-post/contracts';

import {
  REPORT_DETAIL_MAX_LENGTH,
  REPORT_REASON_CHOICES,
} from '../../apps/web/src/app/moderation/report-abuse-draft';

import { mintInviteViaYouScreen } from './support/mint-invite';

/**
 * The report-abuse sheet and the rate-limited sign-in notice, rendered in **both themes**.
 *
 * ⚠ **This suite exists because "it matches the comp" is otherwise an unfalsifiable
 * claim.** `playwright.config.ts` pins `colorScheme: 'light'` for the vertical slice, so
 * until `you-screen.spec.ts` nothing in this repository had ever rendered a screen dark.
 * Every colour on this sheet comes from a `--pp-*` token and both token sets are
 * declared, but a token that is *declared* and a token that *resolves* are different
 * facts, and only one of them is visible in a stylesheet.
 *
 * It writes `docs/engineering/screenshots/m2-report-sheet-*.png` and
 * `m2-sign-in-rate-limited-*.png` when `E2E_MODERATION_SCREENSHOT_DIR` is set — the same
 * opt-in shape `vertical-slice-e2e.spec.ts` uses for `E2E_BOARD_SCREENSHOT_PATH`, so a
 * normal run writes nothing and asserts everything.
 *
 * Advisory, like the rest of `test:e2e` (`docs/engineering/l5-plan.md` D2): it is not one
 * of the nine required CI jobs.
 */

/**
 * The comp's phone column, at the size the comp is drawn for.
 *
 * `.app-column` is a fixed-height flex column and the sheet is `position: absolute`
 * against it, so the framing decides whether the sheet is even on screen. The repo's
 * default `Desktop Chrome` viewport letterboxes that column and would prove the sheet
 * renders somewhere rather than where it belongs. Scoped here rather than in
 * `playwright.config.ts` so the vertical slice keeps the viewport it was written against.
 */
test.use({ viewport: { width: 430, height: 860 }, deviceScaleFactor: 2 });

/**
 * What a reporter types. Its length is asserted against the counter rather than written
 * out as a number, so editing this sentence cannot make the test wrong about the counter.
 */
const REPORT_DETAIL = 'Asked for a deposit up front and the camp does not exist.';

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

/**
 * Writes one PNG, or nothing when the suite is not being run for its pictures.
 *
 * A viewport shot rather than `fullPage`: the sheet is `position: absolute` inside the
 * clipped `.app-column`, so the page has no scroll height to extend into and `fullPage`
 * would produce the same pixels under a name that implies otherwise.
 *
 * ⚠ **`animations: 'disabled'` is load-bearing, not tidiness.** The sheet enters on
 * `pp-report-sheetup`, which animates `opacity` from 0, and Playwright's default
 * (`'allow'`) photographs whatever frame it lands on. The first run of this suite
 * produced four images of a half-transparent sheet with the bulletin card and the tab
 * bar showing through it — a picture of the harness's shutter speed being sold as a
 * picture of the design. This finishes every animation and holds it at its end state.
 */
async function capture(page: Page, name: string): Promise<void> {
  const directory = process.env['E2E_MODERATION_SCREENSHOT_DIR'];

  if (directory === undefined || directory === '') {
    return;
  }

  await page.screenshot({ path: `${directory}/${name}.png`, animations: 'disabled' });
}

/**
 * Seeds the persisted theme the way a returning user carries one.
 *
 * `index.html`'s render-blocking script reads `playapost-theme` before the first paint —
 * this is that mechanism, not a harness back door. It is how the sign-in screen can be
 * dark at all: `/signin` renders outside the app shell and therefore has no theme toggle
 * on it, which is the product's behaviour and not a gap in this test.
 */
async function seedTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.addInitScript((value: string) => {
    (
      globalThis as { localStorage: { setItem(key: string, value: string): void } }
    ).localStorage.setItem('playapost-theme', value);
  }, theme);
}

test.describe('the report-abuse sheet renders in both themes', () => {
  test('shows the comp’s five chips, the blurb, and both send states', async ({ browser }) => {
    const userAAccessToken = requireEnv('E2E_USER_A_ACCESS_TOKEN');
    const userBAccessToken = requireEnv('E2E_USER_B_ACCESS_TOKEN');
    const userBHandle = requireEnv('E2E_USER_B_HANDLE');

    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      // The sheet is only reachable on a bulletin the viewer does not own —
      // `bulletin-detail-sheet.tsx` renders the report control behind `card.own ? null :`.
      // So the two users have to be genuinely connected and the bulletin genuinely
      // authored by the other one. This is `vertical-slice-e2e.spec.ts`'s proven setup,
      // minus the steps that only assert the graph and the notification window.
      await bootstrapSession(pageA, userAAccessToken);
      const inviteToken = await mintInviteViaYouScreen(pageA);

      await bootstrapSession(pageB, userBAccessToken);
      await pageB.goto(`/invite/${inviteToken}`);
      await expect(pageB.getByTestId('invite-open-view')).toBeVisible();
      await pageB.getByTestId('invite-accept-button').click();
      await expect(pageB.getByTestId('connection-accepted-banner')).toBeVisible();

      await pageA.goto('/graph');
      await pageA.getByTestId(`graph-connection-node-${userBHandle}`).click();
      await pageA.getByRole('slider', { name: 'Trust' }).fill('85');
      await pageA.getByTestId('person-sheet-save-trust-button').click();
      // The person sheet is an overlay over the graph, and saving trust does not close
      // it — its scrim would swallow the tap on the compose FAB below.
      await pageA.getByTestId('person-sheet-close-button').click();

      await pageA.getByTestId('compose-bulletin-button').click();
      // `BULLETIN_TYPE.request` rather than a literal, so a rename in the contract's
      // vocabulary (`bulletins/domain/bulletin.ts`) fails here at compile time instead
      // of waiting out the full timeout on an option that no longer exists.
      await pageA.getByTestId('compose-bulletin-type-select').selectOption(BULLETIN_TYPE.request);
      await pageA.getByTestId('compose-bulletin-title-input').fill('Ride to the airport Sunday');
      await pageA
        .getByTestId('compose-bulletin-body-input')
        .fill('Leaving early, happy to chip in for gas.');
      await pageA.getByTestId('compose-bulletin-submit-button').click();

      const createdCard = pageA.locator('[data-testid^="board-bulletin-card-"]').first();
      await expect(createdCard).toBeVisible();
      const bulletinId =
        (await createdCard.getAttribute('data-testid'))?.replace('board-bulletin-card-', '') ?? '';
      expect(bulletinId).not.toBe('');

      for (const theme of ['light', 'dark'] as const) {
        await seedTheme(pageB, theme);
        await pageB.goto('/board');
        await expect(pageB.locator('html')).toHaveAttribute('data-theme', theme);

        await pageB.getByTestId(`board-bulletin-card-${bulletinId}`).getByTestId('bulletin-open-button').click();
        await pageB.getByTestId('bulletin-detail-sheet').getByTestId('bulletin-report-button').click();

        const sheet = pageB.getByTestId('report-abuse-sheet');
        await expect(sheet).toBeVisible();

        // The AC this suite exists for: the five reasons, in the comp's order, with the
        // comp's own words (`design/Playa Post.dc.html:844`). Asserted as one ordered
        // list rather than five independent visibility checks, so a reordering fails.
        await expect(sheet.getByTestId(/^report-reason-/)).toHaveText(
          REPORT_REASON_CHOICES.map((choice) => choice.label),
        );

        // The blurb is load-bearing copy, not decoration — it is the only place the
        // product promises the poster never learns who reported.
        await expect(sheet).toContainText('The poster never learns who reported.');

        // Pristine: nothing chosen, so the send control is dimmed and says why. This is
        // the state the comp draws (`reportOp: … : .45`), made answerable.
        await expect(pageB.getByTestId('report-send-button')).toHaveAttribute(
          'aria-disabled',
          'true',
        );
        await expect(sheet).toContainText('Choose what kind of abuse this is.');
        await capture(pageB, `m2-report-sheet-${theme}`);

        // Filled: a chip selected — which is the only place `--pp-chip-on-*` is visible
        // at all — and the counter in place of the hint.
        await pageB.getByTestId(`report-reason-${REPORT_REASON.scamOrFraud}`).click();
        await pageB.getByTestId('report-detail-input').fill(REPORT_DETAIL);
        await expect(pageB.getByTestId('report-send-button')).toHaveAttribute(
          'aria-disabled',
          'false',
        );
        await expect(sheet).toContainText(
          `${String(REPORT_DETAIL.length)}/${String(REPORT_DETAIL_MAX_LENGTH)}`,
        );
        await capture(pageB, `m2-report-sheet-${theme}-filled`);

        await pageB.getByTestId('report-abuse-close-button').click();
        await expect(sheet).toBeHidden();
      }
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});

/**
 * The notice's two theme-dependent colours, as the browser actually resolved them.
 *
 * Hand-typed against `globalThis` for the reason the session seeder above is: the root
 * `tsconfig.json` sets `lib: ["ES2022"]` with no DOM, so there is no `Window` to lean on.
 * Only types cross this boundary — Playwright ships the function body to the page, and
 * every annotation here is erased before it goes.
 */
interface ResolvedColours {
  readonly color: string;
  readonly borderTopColor: string;
}

interface ColourScope {
  readonly document: { querySelector(selector: string): object | null };
  getComputedStyle(element: object): ResolvedColours;
}

async function noticeColours(
  page: Page,
): Promise<{ text: string; border: string; inherited: string }> {
  return page.evaluate(() => {
    const scope = globalThis as unknown as ColourScope;
    const notice = scope.document.querySelector('.hide-failure');
    const message = scope.document.querySelector('.hide-failure__message');

    if (notice === null || message === null) {
      throw new Error('The hide-failure notice is not on the page.');
    }

    return {
      text: scope.getComputedStyle(message).color,
      border: scope.getComputedStyle(notice).borderTopColor,
      // The notice sets no `color` of its own, so this is the ink the message would fall
      // back to — see the assertion that reads it.
      inherited: scope.getComputedStyle(notice).color,
    };
  });
}

/**
 * A hide that never reached the server is visible to the person who asked for it.
 *
 * ⚠ **This is the only place the wiring can be proven.** `vitest.config.ts` runs the
 * `unit` project in `environment: 'node'` and the repo carries no jsdom, happy-dom, or
 * testing-library — so `describeHideFailure`'s *decisions* are unit-tested
 * (`hide-failure.unit.test.ts`) and its *effects* — the card coming back, the notice
 * rendering, the retry re-sending — have nowhere else to be asserted.
 *
 * `route.abort('connectionfailed')` is the honest stand-in: it makes `fetch` reject with
 * no envelope at all, which is exactly what an offline device produces and exactly what
 * `moderation.report` produces today, since `QUEUED_MUTATION_TYPES` does not include it
 * ([#63](https://github.com/drewdrewthis/playa-post/issues/63)) and
 * `mutations: { retry: false }` means there is no second attempt.
 *
 * Both callers of `hideBulletin` are exercised, because both had the same silence.
 */
test.describe('a report or dismissal that did not reach the server says so', () => {
  test('puts the card back, says what did not happen, and re-sends what was typed', async ({
    browser,
  }) => {
    const userAAccessToken = requireEnv('E2E_USER_A_ACCESS_TOKEN');
    const userBAccessToken = requireEnv('E2E_USER_B_ACCESS_TOKEN');

    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      // The same setup the suite above needs, and for the same reason: dismiss and report
      // are rendered only on a bulletin the viewer does not own
      // (`bulletin-detail-sheet.tsx` — `card.own ? archive : (dismiss, report)`).
      await bootstrapSession(pageA, userAAccessToken);
      const inviteToken = await mintInviteViaYouScreen(pageA);

      await bootstrapSession(pageB, userBAccessToken);
      await pageB.goto(`/invite/${inviteToken}`);
      await pageB.getByTestId('invite-accept-button').click();
      await expect(pageB.getByTestId('connection-accepted-banner')).toBeVisible();

      await pageA.getByTestId('compose-bulletin-button').click();
      await pageA.getByTestId('compose-bulletin-type-select').selectOption(BULLETIN_TYPE.request);
      await pageA.getByTestId('compose-bulletin-title-input').fill('Spare goggles, dusty camp');
      await pageA.getByTestId('compose-bulletin-body-input').fill('Lost mine on the deep playa.');
      await pageA.getByTestId('compose-bulletin-submit-button').click();

      const createdCard = pageA.locator('[data-testid^="board-bulletin-card-"]').first();
      await expect(createdCard).toBeVisible();
      const bulletinId =
        (await createdCard.getAttribute('data-testid'))?.replace('board-bulletin-card-', '') ?? '';
      expect(bulletinId).not.toBe('');

      await pageB.goto('/board');
      const card = pageB.getByTestId(`board-bulletin-card-${bulletinId}`);
      await expect(card).toBeVisible();

      const notice = pageB.getByTestId('hide-failure');

      /* The plain-hide path: a dismissal with no reason, and no sheet to hold it open. */
      await pageB.route('**/trpc/moderation.dismiss*', async (route) => {
        await route.abort('connectionfailed');
      });

      await card.getByTestId('bulletin-open-button').click();
      await pageB.getByTestId('bulletin-dismiss-button').click();

      await expect(notice).toHaveText(
        /Dismissing that bulletin did not reach the server\. It is back on your board\./,
      );
      await expect(card).toBeVisible();

      /*
       * Both themes, on the notice itself, while it is on screen — a live toggle rather
       * than a second two-user setup. Every colour here is a `--pp-*` token declared in
       * both of `tokens.css`'s blocks, but *declared* and *resolves* are different facts
       * and only the second one is worth asserting (the reason the suite above renders
       * the sheet twice). A notice whose words came out transparent in dark would pass
       * every other check in this file.
       */
      const firstTheme = (await pageB.locator('html').getAttribute('data-theme')) ?? 'dark';
      const otherTheme = firstTheme === 'dark' ? 'light' : 'dark';
      const firstColours = await noticeColours(pageB);

      await pageB.getByTestId('theme-toggle-button').click();
      await expect(pageB.locator('html')).toHaveAttribute('data-theme', otherTheme);
      await expect(notice).toBeVisible();
      const otherColours = await noticeColours(pageB);

      for (const colour of [
        firstColours.text,
        firstColours.border,
        otherColours.text,
        otherColours.border,
      ]) {
        // A token that failed to resolve leaves the property at its initial value, which
        // is `rgba(0, 0, 0, 0)` for a colour — invisible, and green on a visibility check.
        expect(colour).toMatch(/^rgba?\(/);
        expect(colour).not.toBe('rgba(0, 0, 0, 0)');
      }

      expect(otherColours.text).not.toBe(firstColours.text);
      expect(otherColours.border).not.toBe(firstColours.border);

      /*
       * ⚠ The assertion that makes the two above mean something. `--pp-danger` failing to
       * resolve does not blank the text — an invalid `var()` leaves `color` at `inherit`,
       * so the message would quietly take the notice's own ink, which *also* differs
       * between themes and would satisfy every check above it. The words being a
       * different colour from the box they sit in is what proves the token arrived.
       */
      expect(firstColours.text).not.toBe(firstColours.inherited);
      expect(otherColours.text).not.toBe(otherColours.inherited);

      // The cycle is three stops now (light → dark → system → light, issue #151), so two
      // more taps — not one — walk system → light → dark and land back on `firstTheme`.
      await pageB.getByTestId('theme-toggle-button').click();
      await pageB.getByTestId('theme-toggle-button').click();
      await expect(pageB.locator('html')).toHaveAttribute('data-theme', firstTheme);

      await pageB.unroute('**/trpc/moderation.dismiss*');
      await pageB.getByTestId('hide-failure-dismiss-button').click();
      await expect(notice).toBeHidden();

      /*
       * The report path. Every attempt's body is captured, so the retry can be shown to
       * carry the reporter's own words — the sheet that collected them was unmounted the
       * moment Send was pressed, and re-sending them is what makes that survivable.
       */
      const reportBodies: string[] = [];

      await pageB.route('**/trpc/moderation.report*', async (route) => {
        reportBodies.push(route.request().postData() ?? '');

        if (reportBodies.length === 1) {
          await route.abort('connectionfailed');
          return;
        }

        await route.continue();
      });

      await card.getByTestId('bulletin-open-button').click();
      await pageB.getByTestId('bulletin-report-button').click();
      await pageB.getByTestId(`report-reason-${REPORT_REASON.scamOrFraud}`).click();
      await pageB.getByTestId('report-detail-input').fill(REPORT_DETAIL);
      await pageB.getByTestId('report-send-button').click();

      // The defect, inverted: the reporter is told the stewards do not have it, and the
      // card they were told was handled is back where it was.
      await expect(notice).toHaveText(
        /Your report did not reach the stewards\. The bulletin is back on your board\./,
      );
      await expect(card).toBeVisible();

      await pageB.getByTestId('hide-failure-retry-button').click();

      await expect(notice).toBeHidden();
      await expect(card).toBeHidden();

      expect(reportBodies).toHaveLength(2);
      // Both attempts carry the account that was typed once, into a sheet that no longer
      // exists by the time the second one is sent.
      for (const body of reportBodies) {
        expect(body).toContain(REPORT_DETAIL);
      }
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});

/**
 * The provider's own 429 body, verbatim in shape.
 *
 * ⚠ **The auth provider is the one boundary this stands in for**, and it stands in at
 * the wire — `@supabase/supabase-js` parses this response itself, so the `AuthApiError`
 * `describeSignInFailure` receives is the real library's real object, not a hand-built
 * one. A rate limit is by definition not something a test may reproduce by asking for it
 * politely; everything downstream of this response is the shipping code path.
 */
const RATE_LIMIT_BODY = JSON.stringify({
  code: 429,
  error_code: 'over_email_send_rate_limit',
  msg: 'For security purposes, you can only request this after 51 seconds.',
});

test.describe('a rate-limited sign-in tells the user to wait, in both themes', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`renders the wait notice in ${theme}`, async ({ page }) => {
      await page.route('**/auth/v1/otp**', async (route) => {
        await route.fulfill({ status: 429, contentType: 'application/json', body: RATE_LIMIT_BODY });
      });

      await seedTheme(page, theme);
      await page.goto('/signin');
      await expect(page.getByTestId('sign-in')).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

      await page.getByLabel('Email').fill('someone@example.com');
      await page.getByRole('button', { name: 'Send me a sign-in link' }).click();

      // The bug this replaces sent a rate-limited user back to re-read an address that
      // was never wrong. Both halves are asserted: that the wait advice arrives, and
      // that the advice it replaced is gone.
      const failure = page.getByRole('alert');
      await expect(failure).toHaveText(
        'Too many sign-in attempts for that address. Wait a few minutes and try again — the last email we sent is still valid.',
      );
      await expect(failure).not.toContainText('Check the address');

      await capture(page, `m2-sign-in-rate-limited-${theme}`);
    });
  }
});

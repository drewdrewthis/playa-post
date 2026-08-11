import { expect, test, type Page } from '@playwright/test';

/**
 * The one-time code alternative to the magic link (issue #179): a magic link opens the
 * system browser, which never hands a session back to an installed PWA, so the same
 * sign-in email also carries a six-digit code the screen itself can verify.
 *
 * Wire-level interception, like the rate-limited case in `report-abuse-sheet.spec.ts`:
 * `VITE_SUPABASE_URL` points at an unreachable address (`playwright.config.ts`), so
 * every assertion below runs through the real `@supabase/supabase-js` client and the
 * real `describeSignInFailure` — only the provider's own response is stood in for.
 *
 * The success case hands back one of `global-setup.ts`'s already-onboarded users' real,
 * validly-signed access tokens as the mocked `/auth/v1/verify` response's
 * `access_token`, rather than an arbitrary string. Landing off `/signin` alone would be
 * true of any truthy token; using a real one also proves the real server accepts what
 * the code screen hands it and renders the real authenticated app — the same bar
 * `vertical-slice-e2e.spec.ts` holds every other sign-in-adjacent path to, and the only
 * way to assert a stable final screen rather than a redirect that a 401 a moment later
 * (`auth/require-session.tsx`'s `UNAUTHORIZED` branch) could otherwise bounce back.
 *
 * AC6 (a spent code cannot be reused) is not a separate case here: GoTrue answers a
 * wrong digit, an expired code, and an already-spent code with the identical
 * `otp_expired` / HTTP 403 signal (`sign-in-failure.unit.test.ts`'s own doc comment), so
 * a mocked "second submission" would only prove this suite's own mock returns what it
 * was told to return. That collapse, and the one merged message it produces, is
 * `describeSignInFailure`'s job — covered below and in the unit suite. The reuse
 * guarantee itself is Supabase's to keep, not this app's to re-implement or re-test.
 *
 * Advisory, like the rest of `test:e2e` (`docs/engineering/l5-plan.md` D2).
 */

function requireEnv(name: string): string {
  const value = process.env[name];

  if (value === undefined || value === '') {
    throw new Error(`${name} is not set — tests/e2e/global-setup.ts should have set it`);
  }

  return value;
}

/**
 * Screenshots are captured only when `E2E_SIGN_IN_CODE_SCREENSHOT_DIR` is set — the
 * same opt-in shape as `E2E_YOU_SCREENSHOT_DIR` in `you-screen.spec.ts`, so a normal
 * run writes nothing.
 */
async function capture(page: Page, name: string): Promise<void> {
  const directory = process.env['E2E_SIGN_IN_CODE_SCREENSHOT_DIR'];
  if (directory === undefined || directory === '') {
    return;
  }

  await page.screenshot({ path: `${directory}/${name}.png`, animations: 'disabled' });
}

/**
 * A bare `{}` on a 200 is the minimal success shape: `signInWithOtp`'s email branch
 * calls `_request` with no `xform`, and `_request` resolves `{ data: {...json}, error:
 * null }` off nothing but `result.ok` (`@supabase/auth-js/lib/fetch.js`) — the body's
 * content is never read.
 */
async function mockSignInLinkSent(page: Page): Promise<void> {
  await page.route('**/auth/v1/otp**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

/** Advances the sign-in screen from the email form to the code form. */
async function requestCode(page: Page): Promise<void> {
  await page.goto('/signin');
  await expect(page.getByTestId('sign-in')).toBeVisible();

  await page.getByLabel('Email').fill('someone@example.com');
  await page.getByRole('button', { name: 'Send me a sign-in link' }).click();

  await expect(page.getByTestId('sign-in-link-sent')).toBeVisible();
  await expect(page.getByTestId('sign-in-code-input')).toBeVisible();
}

test.describe('signing in with the emailed code', () => {
  test('a correct code signs the user in, the same as the magic link would', async ({ page }) => {
    const accessToken = requireEnv('E2E_USER_C_ACCESS_TOKEN');

    await mockSignInLinkSent(page);
    await page.route('**/auth/v1/verify**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          access_token: accessToken,
          refresh_token: 'e2e-mock-refresh-token',
          expires_in: 3600,
          token_type: 'bearer',
        }),
      });
    });

    await requestCode(page);

    await page.getByTestId('sign-in-code-input').fill('123456');
    await capture(page, 'sign-in-code-entry');
    await page.getByTestId('sign-in-code-submit-button').click();

    // Off `/signin` and into the real, unmocked app: `RequireSession`'s `graph.list`
    // probe runs against the real server with this real token and succeeds — the same
    // gate every other authenticated screen in this suite sits behind.
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId('graph-home')).toBeVisible();
  });

  test('an incorrect or expired code is rejected without signing the user in', async ({ page }) => {
    await mockSignInLinkSent(page);
    await page.route('**/auth/v1/verify**', async (route) => {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        // The provider's own envelope, verbatim in shape — see `RATE_LIMIT_BODY` in
        // `report-abuse-sheet.spec.ts` for why this test stands in at the wire rather
        // than hand-building an `AuthApiError`.
        body: JSON.stringify({
          code: 403,
          error_code: 'otp_expired',
          msg: 'Token has expired or is invalid',
        }),
      });
    });

    await requestCode(page);

    await page.getByTestId('sign-in-code-input').fill('000000');
    await page.getByTestId('sign-in-code-submit-button').click();

    const failure = page.getByRole('alert');
    await expect(failure).toHaveText(
      'That code did not match — it may be mistyped, expired, or already used. Request a new sign-in email and enter the fresh code.',
    );

    // Rejected, not signed in: still the code screen, not the app.
    await expect(page.getByTestId('sign-in-code-input')).toBeVisible();
    await expect(page).toHaveURL(/\/signin$/);
    await capture(page, 'sign-in-code-rejected');

    // The rejection copy says "Request a new sign-in email" — that offer must
    // actually be there and must actually work.
    await page.getByTestId('sign-in-request-new-code-button').click();
    await expect(page.getByLabel('Email')).toBeVisible();
  });
});

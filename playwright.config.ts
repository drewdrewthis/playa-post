import { defineConfig, devices } from '@playwright/test';

import { API_PORT, WEB_PORT } from './tests/e2e/support/e2e-ports';

/**
 * The one Playwright config in the repo, for the one browser-driven suite M2 has
 * (`m2-lane-briefs.md` §"What `@e2e` means in a lane" — Playwright and two browser
 * contexts are exclusive to L5's `vertical-slice-e2e.feature`; every other `@e2e`
 * scenario in M1–M4 is API-level, run by Vitest).
 *
 * **Light theme only, per L5's scope** (`m2-lane-briefs.md` §L5 — "Light theme only.
 * No service worker yet.") — one project, no dark-mode variant, `colorScheme: 'light'`
 * pinned explicitly rather than left to the OS default so CI and a developer's machine
 * render the same thing.
 *
 * `global-setup.ts` boots the real Postgres + real API server before this file's
 * `webServer` entry starts the Vite dev server for `apps/web` — see that file for why
 * the two share `tests/e2e/support/e2e-ports.ts`'s fixed ports rather than passing one
 * discovered at runtime.
 */
export default defineConfig({
  testDir: './tests/e2e',
  // The eleven-step test legitimately spends ~60-75s inside step 9 waiting out the
  // 60-second notification grouping window (M2-AC7 — a domain constant the harness
  // must not shorten), so Playwright's 30s default would fail a correct run. 180s
  // covers that window plus the other ten steps with margin.
  timeout: 180_000,
  fullyParallel: false,
  forbidOnly: Boolean(process.env['CI']),
  retries: 0,
  workers: 1,
  reporter: [['html', { open: 'never' }], ['list']],
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    colorScheme: 'light',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], colorScheme: 'light' },
    },
  ],
  webServer: {
    command: `pnpm --filter @playa-post/web exec vite --port ${WEB_PORT} --strictPort`,
    url: `http://127.0.0.1:${WEB_PORT}`,
    reuseExistingServer: !process.env['CI'],
    // 180s, not the 60s default-ish value shipped first: CI run 31133839942 timed out
    // at 60s waiting for a cold pnpm/vite start that warm local runs never see.
    timeout: 180_000,
    // Forward Vite's own output into the runner log: that run's 12-line log could not
    // distinguish a slow start from a failed one (crash, env, port already bound).
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      // Fixed, not discovered at runtime — see `tests/e2e/support/e2e-ports.ts`'s
      // doc comment for why `global-setup.ts` cannot hand this value to this file.
      VITE_API_BASE_URL: `http://127.0.0.1:${API_PORT}`,
    },
  },
});

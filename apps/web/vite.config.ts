import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Where this browser build sends `/trpc` traffic.
 *
 * Read here, in the Node process that runs Vite — **not** in the browser bundle. The
 * app always calls the **relative** path `/trpc`, and this config decides what sits
 * behind it: the dev/preview server proxies to the API, so the two never see each
 * other cross-origin and the server needs no CORS layer to be driven by a browser.
 * `tests/e2e/support/e2e-ports.ts` sets this for the e2e run.
 */
const apiBaseUrl = nodeEnvironment()['VITE_API_BASE_URL'] ?? 'http://127.0.0.1:3000';

/**
 * `process.env`, read without pulling Node's global types into this workspace.
 *
 * `apps/web/tsconfig.json` pins `types` to `vite/client` on purpose: the app's source
 * is browser code, and making `Buffer`, `process`, and `__dirname` type-check inside it
 * would hide a real mistake. This config file is the one place under `apps/web` that
 * genuinely runs in Node, so it narrows the global rather than widening the project.
 */
function nodeEnvironment(): Readonly<Record<string, string | undefined>> {
  const runtime = globalThis as { process?: { env?: Record<string, string | undefined> } };

  return runtime.process?.env ?? {};
}

/**
 * PWA-ready by construction: the product must work offline (addendum §14), so the
 * service worker exists from the first commit rather than being retrofitted once
 * caching assumptions have already hardened.
 *
 * `registerType: 'autoUpdate'` is deliberate — a community app should not ask a
 * user to approve an update; the offline store is versioned separately (M4).
 *
 * ⚠ `devOptions.enabled: false` is load-bearing for the browser e2e, not a
 * preference. An `autoUpdate` worker registered against the dev server can serve a
 * stale shell mid-run, and its symptom is the worst kind: a step that passes in
 * isolation and fails in sequence. M2 builds no offline caching *on* the worker —
 * offline state is Dexie only (`m2-lane-briefs.md` §L5, "No service worker yet") — so
 * disabling it in development costs nothing the milestone is claiming.
 */
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      devOptions: {
        enabled: false,
      },
      manifest: {
        id: '/',
        name: 'Playa Post',
        short_name: 'Playa Post',
        description: 'A private, opt-in community trust network.',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        theme_color: '#0b0b0f',
        background_color: '#0b0b0f',
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
    }),
  ],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/trpc': { target: apiBaseUrl, changeOrigin: true },
    },
  },
  preview: {
    proxy: {
      '/trpc': { target: apiBaseUrl, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});

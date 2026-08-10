import { registerSW } from 'virtual:pwa-register';

/**
 * Registers the service worker through the plugin's real client, so a deploy reaches a
 * client that is already open — not just a fresh page load.
 *
 * Without this import, `injectRegister: 'auto'` (`vite.config.ts`) falls back to its own
 * dumb inline script: it calls `navigator.serviceWorker.register()` and nothing else, so
 * a reopened tab renders one stale paint before the new worker takes over (new version
 * visible only on the *second* reopen), and a tab that is never reopened stays on the old
 * build forever — nothing ever checks. Importing `virtual:pwa-register` ourselves is what
 * switches the plugin onto this client instead and turns the dumb script off.
 *
 * In `registerType: 'autoUpdate'` mode, that client already reloads the page once a new
 * worker activates — `workbox-window`'s `activated` event, `isUpdate || isExternal`
 * (`vite-plugin-pwa/dist/client/build/register.js`). That alone fixes the reopened tab:
 * the worker that was waiting takes over and the reload lands on the new build.
 *
 * It does not fix the idle tab. Nothing in that client ever calls
 * `registration.update()` on its own, and a tab that never navigates never gives the
 * browser a reason to check for a new worker — so it can sit on a stale build
 * indefinitely. The hourly poll below exists only to close that gap.
 *
 * No `import.meta.env.DEV` guard: `vite.config.ts` sets `devOptions.enabled: false`, and
 * under that setting the plugin resolves `virtual:pwa-register` to a stub whose
 * `registerSW` is an unconditional no-op (`vite-plugin-pwa/dist/client/dev/register.js`)
 * — calling it in dev registers nothing.
 */
registerSW({
  immediate: true,
  onRegisteredSW(_swScriptUrl, registration) {
    // No registration handed back — nothing to poll, so don't arm a forever-spinning
    // no-op interval.
    if (!registration) {
      return;
    }

    // An idle tab never navigates, so the browser never checks for a new worker on its
    // own — this is the only thing that does, for as long as the tab stays open.
    setInterval(() => {
      // Offline: `update()` would reject on the fetch it can't make, and there is
      // nothing new to find until connectivity returns anyway.
      if (!navigator.onLine) {
        return;
      }

      registration.update().catch(() => {
        // A transient network failure — the next tick tries again.
      });
    }, 60 * 60 * 1000);
  },
});

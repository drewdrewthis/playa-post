/**
 * Fixed ports the browser e2e harness agrees on ahead of time.
 *
 * `playwright.config.ts` resolves its `webServer` entries (including the env it hands
 * the Vite dev server) once, synchronously, when the config module loads — **before**
 * `global-setup.ts` runs. A port chosen inside `global-setup.ts` therefore cannot
 * reach the web server's environment by reference; the two must agree on a constant
 * instead. The API server binds `API_PORT` in `global-setup.ts`; the web app receives
 * it as `VITE_API_BASE_URL` in `playwright.config.ts`'s `webServer.env`.
 *
 * The mock Supabase JWT issuer and the mock Web Push transport need no fixed port:
 * both live only on the server side of `global-setup.ts` and are never referenced by
 * the browser or by `playwright.config.ts`.
 */
export const API_PORT = 4300;
export const WEB_PORT = 5183;

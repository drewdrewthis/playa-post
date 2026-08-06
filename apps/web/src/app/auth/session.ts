/** A signed-in browser session: the bearer token, and nothing else worth caching. */
export interface Session {
  readonly accessToken: string;
}

/**
 * Where the app is in the sign-in lifecycle.
 *
 * `loading` is a real state, not a nicety: the Supabase client restores a session
 * asynchronously, and a router that treats "not yet known" as "anonymous" bounces an
 * already-signed-in user to `/signin` on every hard refresh.
 */
export type SessionStatus = 'loading' | 'anonymous' | 'signed-in';

/**
 * Read a session seeded into the page by a **development or test** harness.
 *
 * ⚠ **Compiled out of every production build.** `import.meta.env.DEV` is the literal
 * `false` in `vite build`, so this guard makes everything below it dead code the
 * bundler removes — including the storage key, which is why the key is declared inside
 * the branch and never exported. `pnpm build:web` output therefore contains no
 * sign-in bypass to grep for (AC-L5-9), and there is no runtime flag an attacker could
 * flip: the code is not in the bundle.
 *
 * The browser e2e uses it because the real magic-link flow has no mailbox a headless
 * run can read, and only the Supabase Auth **JWT issuer** is on the allowed-mock list
 * — not the delivery channel (`m2-lane-briefs.md` §"TDD hand-off shape"). Everything
 * downstream of the token stays real: the server verifies ES256 against the issuer's
 * JWKS, unmodified.
 */
export function readHarnessSession(): Session | null {
  if (!import.meta.env.DEV) {
    return null;
  }

  const raw = window.localStorage.getItem('playa-post:e2e-session');

  if (raw === null) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);

    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as { accessToken?: unknown }).accessToken === 'string'
    ) {
      return { accessToken: (parsed as { accessToken: string }).accessToken };
    }
  } catch {
    // A malformed seed is the harness's bug, not the user's: fall through to the real
    // sign-in path rather than blanking the app on a JSON parse error.
  }

  return null;
}

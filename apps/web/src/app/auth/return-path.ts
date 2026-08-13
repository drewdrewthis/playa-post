import type { Location } from 'react-router';

/**
 * Where a visitor was heading before an auth screen interrupted them (#205).
 *
 * `RequireSession` bounces an anonymous visitor to `/welcome` or `/signin`, and a
 * not-yet-onboarded one to `/onboarding`. Before this existed, every one of those
 * `Navigate`s used `replace` with no state, so the address the person actually opened —
 * an invite link, a board deep link — was discarded and they landed on `/` after
 * signing in, needing the original link a second time.
 *
 * The path rides `location.state.from` through each hop (welcome → sign-in →
 * onboarding) because router state is per-navigation and per-tab: nothing to clean up,
 * and two tabs signing in at once cannot clobber each other the way a storage key
 * would. The cost is that a magic link opened in a *new* tab starts with fresh state —
 * accepted, because the in-app code entry is the flow that keeps the same tab
 * (issue #179), and the magic-link tab never knew the destination to begin with.
 */

/** The state shape each auth screen forwards. Router state is untyped; keep this small. */
export interface ReturnPathState {
  readonly from: string;
}

/** The current address as a `from` value: path, query, and fragment, origin-relative. */
export function capturePath(location: Location): ReturnPathState {
  return { from: `${location.pathname}${location.search}${location.hash}` };
}

/**
 * The forwarded `from`, or `null` when there is none worth honouring.
 *
 * Router state arrives untyped from `history.state`, which any earlier page code can
 * have written — so this validates rather than casts. Only an origin-relative path is
 * returned: a value not starting with `/` could name another origin outright, and
 * `//host` is scheme-relative — both would turn a stored path into an open redirect.
 */
export function returnPathFrom(state: unknown): string | null {
  if (typeof state !== 'object' || state === null) {
    return null;
  }

  const from = (state as { from?: unknown }).from;

  if (typeof from !== 'string' || !from.startsWith('/') || from.startsWith('//')) {
    return null;
  }

  return from;
}

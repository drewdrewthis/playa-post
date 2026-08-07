/** The four destinations in the bottom tab bar. */
export type TabId = 'graph' | 'board' | 'saved' | 'you';

/**
 * The paths that belong to each tab, beyond the tab's own.
 *
 * A person sheet counts as Graph because that is where a user came from and where
 * "back" takes them; compose counts as Board for the same reason. Without this the tab
 * bar would go blank the moment a user pushed one level deeper, which reads as having
 * navigated out of the app.
 */
const TAB_PATHS: readonly (readonly [TabId, readonly string[]])[] = [
  ['graph', ['/graph', '/people']],
  ['board', ['/board']],
  ['saved', ['/saved']],
  ['you', ['/you']],
];

/**
 * Which tab a path belongs to, or `null` for a path that belongs to none.
 *
 * `/` maps to Graph rather than to nothing: the router serves graph home from both `/`
 * and `/graph` (see `router.tsx`), so a freshly-opened app is on the Graph tab even
 * though its URL does not say so.
 *
 * `null` is a real answer, not a fallback — `/invite/:token` is reached from outside the
 * app entirely, and highlighting an arbitrary tab there would claim a location the user
 * did not navigate to.
 */
export function activeTabFor(pathname: string): TabId | null {
  if (pathname === '/') {
    return 'graph';
  }

  for (const [tab, paths] of TAB_PATHS) {
    if (paths.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
      return tab;
    }
  }

  return null;
}

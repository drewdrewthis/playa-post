/**
 * The welcome invite popup's device-side memory (issue #220): has this device asked
 * not to see it again?
 *
 * `localStorage`, deliberately, and not the server — the same reasoning as
 * `welcome-steps.ts`'s `playapost-onboarded` flag one file over: "don't show me again"
 * is a statement about *this screen on this device*, and a server-side flag would hide
 * the popup on a friend's borrowed phone because the owner dismissed it on their own.
 *
 * ⚠ Two dismissals exist and only one lives here. Pressing Dismiss with the checkbox
 * unchecked closes the popup for the current visit only — that is component state, not
 * storage — so the next app open offers the link again. Only the explicit "don't show
 * this again" choice writes the flag.
 */

/**
 * How long the shell waits after mounting before the popup rises. Long enough for the
 * screen behind it to paint and be recognisably the app — a dialog that beats its own
 * background feels like an interstitial, not a welcome — and short enough that the
 * user has not yet started doing something the popup would interrupt.
 */
export const INVITE_HINT_DELAY_MS = 1600;

const INVITE_HINT_DISMISSED_KEY = 'playapost-invite-hint-dismissed';

/** Wrapped like `welcome-steps.ts`: storage can throw (private mode, disabled). */
export function hasDismissedInviteHint(): boolean {
  try {
    return globalThis.localStorage.getItem(INVITE_HINT_DISMISSED_KEY) !== null;
  } catch {
    // No storage means no way to honour "don't show me again"; a popup that returns
    // on every open despite that choice is worse than one that never shows, so an
    // unreadable flag counts as dismissed.
    return true;
  }
}

export function dismissInviteHintForever(): void {
  try {
    globalThis.localStorage.setItem(INVITE_HINT_DISMISSED_KEY, '1');
  } catch {
    // Nothing to do: the next open shows the popup again, which is survivable.
  }
}

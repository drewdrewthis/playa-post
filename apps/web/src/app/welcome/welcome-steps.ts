/**
 * The welcome carousel's three steps, verbatim from `design/Playa Post.dc.html`'s
 * `obSteps`, and the has-seen flag that decides whether an anonymous visitor lands
 * here or straight on `/signin`.
 *
 * The flag lives in `localStorage` under the comp's own key (`playapost-onboarded`) —
 * device-scoped on purpose. Welcome is a pitch to somebody who may never sign in, so
 * there is no account to hang the flag on; a signed-in user replays it from the You
 * screen, not because a server forgot they saw it.
 */

export interface WelcomeStep {
  readonly icon: string;
  readonly title: string;
  readonly body: string;
  /** A sample query, rendered as code — only the search step has one. */
  readonly code: string | null;
}

export const WELCOME_STEPS: readonly WelcomeStep[] = [
  {
    icon: '◉',
    title: 'Your graph is yours',
    body: 'People join by invitation and consent. Trust is a private 0–100 dial, directional, and visible only to you. Pan and zoom — clusters form around the people you trust.',
    code: null,
  },
  {
    icon: '▤',
    title: 'Short, typed bulletins',
    body: 'Offers, requests, events, collabs, thanks, intros. They expire. To reach someone, pin a note to their board — there is no inbox.',
    code: null,
  },
  {
    icon: '⌕',
    title: 'Search like a local',
    body: 'The board speaks a tiny query language. Save any search as a view and get pinged when new bulletins match.',
    code: 'type:offer trust:>=60 -truck',
  },
];

const WELCOME_SEEN_KEY = 'playapost-onboarded';

/** Wrapped like `theme-preference.ts`: storage can throw (private mode, disabled). */
export function hasSeenWelcome(): boolean {
  try {
    return globalThis.localStorage.getItem(WELCOME_SEEN_KEY) !== null;
  } catch {
    // No storage means no way to remember either answer; showing welcome on every
    // visit would make the app unenterable, so an unreadable flag counts as seen.
    return true;
  }
}

export function markWelcomeSeen(): void {
  try {
    globalThis.localStorage.setItem(WELCOME_SEEN_KEY, '1');
  } catch {
    // Nothing to do: the next visit shows welcome again, which is survivable.
  }
}

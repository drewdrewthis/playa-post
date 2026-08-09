/**
 * The welcome carousel's steps, and the has-seen flag that decides whether an
 * anonymous visitor lands here or straight on `/signin`.
 *
 * The first three steps are verbatim from `design/Playa Post.dc.html`'s `obSteps`.
 * The five after them are an owner-requested extension beyond the comp: a community
 * intro tracing how the network embodies the ten principles plus consent. Each themed
 * step leads with the principles it grounds; the closing step names all eleven, each
 * glossed by the concrete behaviour that honours it — every gloss is a claim about
 * something the app actually does, so if a feature changes, its gloss owes an edit.
 * The roll-call runs in Burning Man's own published order with Consent appended last,
 * so it is deliberately not alphabetical — do not tidy it.
 *
 * The flag lives in `localStorage` under the comp's own key (`playapost-onboarded`) —
 * device-scoped on purpose. Welcome is a pitch to somebody who may never sign in, so
 * there is no account to hang the flag on; a signed-in user replays it from the You
 * screen, not because a server forgot they saw it.
 */

export interface WelcomePrinciple {
  readonly name: string;
  readonly gloss: string;
}

export interface WelcomeStep {
  readonly icon: string;
  readonly title: string;
  readonly body: string;
  /** A sample query, rendered as code — only the search step has one. */
  readonly code: string | null;
  /** The full principle roll-call — only the closing step has one. */
  readonly principles: readonly WelcomePrinciple[] | null;
}

export const WELCOME_STEPS: readonly WelcomeStep[] = [
  {
    icon: '◉',
    title: 'Your graph is yours',
    body: 'People join by invitation and consent. Trust is a private 0–100 dial, directional, and visible only to you. Pan and zoom — clusters form around the people you trust.',
    code: null,
    principles: null,
  },
  {
    icon: '▤',
    title: 'Short, typed bulletins',
    body: 'Offers, requests, events, collabs, thanks, intros. They expire. To reach someone, pin a note to their board — there is no inbox.',
    code: null,
    principles: null,
  },
  {
    icon: '⌕',
    title: 'Search like a local',
    body: 'The board speaks a tiny query language. Save any search as a view and get pinged when new bulletins match.',
    code: 'type:offer trust:>=60 -truck',
    principles: null,
  },
  {
    icon: '✶',
    title: 'Included, by consent',
    body: 'Everyone is welcome; no one is exposed. Each connection is offered and accepted, never scraped, and your reach dial bounds how far your presence carries. Nothing travels further than its owner chose. Everyone answers to their neighbours, too: anything harmful can be reported.',
    code: null,
    principles: null,
  },
  {
    icon: '✿',
    title: 'Gifts, not products',
    body: 'A bulletin is an offer to your neighbours; a note is a gift left on one board. No ads, no follower counts, no ranking algorithm — nothing here is for sale, least of all your attention.',
    code: null,
    principles: null,
  },
  {
    icon: '◐',
    title: 'Here, and then gone',
    body: 'Bulletins expire on their own. The board is what the people around you are doing right now, not an archive to scroll — and it only exists because people pin things to it. Showing up is the whole feed.',
    code: null,
    principles: null,
  },
  {
    icon: '◇',
    title: 'Leave no trace',
    body: 'Expired bulletins leave every board, and nothing you post is broadcast beyond your reach. Your words belong to the people you gave them to.',
    code: null,
    principles: null,
  },
  {
    icon: '✺',
    title: 'Ten principles, plus one',
    body: 'Playa Post is built on the culture that built Black Rock City.',
    code: null,
    principles: [
      { name: 'Radical Inclusion', gloss: 'someone who trusts you welcomes you in' },
      { name: 'Gifting', gloss: 'notes and bulletins ask for nothing back' },
      { name: 'Decommodification', gloss: 'no ads, no follower counts, nothing for sale' },
      { name: 'Radical Self-reliance', gloss: 'posts written offline queue and sync when you return' },
      { name: 'Radical Self-expression', gloss: 'your board, your words, six ways to post' },
      { name: 'Communal Effort', gloss: 'the graph is built two people at a time' },
      { name: 'Civic Responsibility', gloss: 'harm can be reported; boards answer to their people' },
      { name: 'Leaving No Trace', gloss: 'expired bulletins leave every board' },
      { name: 'Participation', gloss: 'the board exists because you pin to it' },
      { name: 'Immediacy', gloss: 'here and now, then off the board' },
      { name: 'Consent', gloss: 'nothing is seen beyond the reach its owner set' },
    ],
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

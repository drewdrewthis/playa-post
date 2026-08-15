/**
 * The welcome carousel's steps, and the has-seen flag that decides whether an
 * anonymous visitor lands here or straight on `/signin`.
 *
 * Three steps, owner-directed (#214) after first-user feedback that the earlier
 * eight-step flow was too long: an extended-family framing, the principle roll-call,
 * and a concrete offers-and-privacy close. The opening and closing copy is the
 * owner's wording near-verbatim; the roll-call carries over unchanged. Each gloss in
 * the roll-call is a claim about something the app actually does, so if a feature
 * changes, its gloss owes an edit. The roll-call runs in Burning Man's own published
 * order with Consent appended last, so it is deliberately not alphabetical — do not
 * tidy it.
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
  /** The full principle roll-call — only the middle step has one. */
  readonly principles: readonly WelcomePrinciple[] | null;
}

export const WELCOME_STEPS: readonly WelcomeStep[] = [
  {
    icon: '✿',
    title: 'Your extended family',
    body: 'Your social network is like your extended family: based on trust and made up of good people. Playa Post is a central place to offer gifts to that family and to ask for help.',
    principles: null,
  },
  {
    icon: '✺',
    title: 'Ten principles, plus one',
    body: 'Playa Post is built on the culture that built Black Rock City.',
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
  {
    icon: '◉',
    title: 'Offer, ask, trust',
    body: 'Offer events, gatherings, collaborations. A cup of tea or a place to crash. Ask for help if you need it. Everything is private by default, and only people you trust can find you or see your posts.',
    principles: null,
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

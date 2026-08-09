import { VISIBLE_TO_DISTANCE_OPTIONS, type VisibleToDistance } from '@playa-post/contracts';

/**
 * The "Who can see you" dial — pure cycling logic and copy, kept out of the route so
 * both are unit-testable without rendering.
 *
 * The comp's privacy pills cycle on tap (`(n + 1) % 3` in `design/Playa Post.dc.html`);
 * this dial cycles the four distance values the server accepts, in the contract's
 * least-permissive-first order: 1st → 2nd → 3rd → anyone → back to 1st.
 *
 * ⚠ The comp says "who sees your name"; the product owner corrected that to **"who can
 * see you at all"** — beyond the limit a person is absent from the other side's graph
 * entirely, not present as an unnamed node. The section copy below states that meaning,
 * because a privacy control whose label undersells what it does teaches people the
 * wrong model of their own exposure.
 */
export const VISIBILITY_DIAL_LABELS: Readonly<Record<VisibleToDistance, string>> = {
  first: '1ST° ONLY',
  second: 'UP TO 2ND°',
  third: 'UP TO 3RD°',
  anyone: 'ANYONE',
};

/** What the setting means, in the viewer's terms — rendered under the dial. */
export function describeVisibility(distance: VisibleToDistance): string {
  switch (distance) {
    case 'first':
      return 'Only people you are directly connected to know you exist.';
    case 'second':
      return 'People up to two hops away can see you. Beyond that, you are not on their graph at all.';
    case 'third':
      return 'People up to three hops away can see you. Beyond that, you are not on their graph at all.';
    case 'anyone':
      return 'Anyone in your network can see that you exist.';
  }
}

/** The next value a tap moves the dial to, looping like the comp's pills. */
export function nextVisibility(current: VisibleToDistance): VisibleToDistance {
  const index = VISIBLE_TO_DISTANCE_OPTIONS.indexOf(current);
  const next = VISIBLE_TO_DISTANCE_OPTIONS[(index + 1) % VISIBLE_TO_DISTANCE_OPTIONS.length];
  // `indexOf` cannot miss (`current` is typed to the same tuple) and the modulo stays
  // in bounds, but `noUncheckedIndexedAccess` cannot see that.
  return next ?? 'first';
}

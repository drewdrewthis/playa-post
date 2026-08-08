import type { Person } from '@playa-post/contracts';

/**
 * The counts strip above the network — the comp's `headerSub`, minus the part this app
 * cannot honestly compute.
 *
 * The comp reads `(people - 1) PEOPLE · N TRUSTED · N BULLETINS`. The bulletin total is
 * not on this screen's payload and is not worth a second round trip to put a number in
 * a subtitle, so the strip carries the two counts the graph itself already answers.
 */

/** The degree the viewer carries on their own graph. */
const VIEWER_DEGREE = 0;

/** The comp's threshold for "trusted": half the scale, and it is a product decision, not a guess. */
export const TRUSTED_THRESHOLD = 50;

/** How large the viewer's network is, and how much of it they have vouched for. */
export interface GraphSummary {
  /** Everybody on the graph **except** the viewer. */
  readonly people: number;
  /** How many of those the viewer's own trust puts at or above {@link TRUSTED_THRESHOLD}. */
  readonly trusted: number;
}

/**
 * Count a viewer's network.
 *
 * ⚠ `trust` of `null` is *unset*, not zero, and an unset opinion is not a low one — it
 * simply is not counted. `person.trust` is the viewer's own directional value and
 * reaches nobody else (ADR-0004 decision 6), so summing it here discloses nothing that
 * the person sheet does not already show.
 */
export function summariseGraph(people: readonly Person[]): GraphSummary {
  const others = people.filter((person) => person.degree !== VIEWER_DEGREE);

  return {
    people: others.length,
    trusted: others.filter((person) => person.trust !== null && person.trust >= TRUSTED_THRESHOLD)
      .length,
  };
}

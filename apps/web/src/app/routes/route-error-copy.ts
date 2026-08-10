/**
 * The words the two failure screens say (issue #125), kept in one module so the
 * `errorElement` and the `*` catch-all cannot drift into two different voices.
 *
 * Copy only — which screen renders which pair is the router's business, not this
 * module's. There is no "decide what happened" function here: with a `*` catch-all in
 * the tree and no loaders or actions anywhere in it, React Router never hands a 404
 * response to the boundary, so a screen that branched on the thrown value would be
 * branching on a case that cannot occur.
 */

/** The `*` catch-all's copy: nothing broke, the address just doesn't lead anywhere. */
export const NOT_FOUND_TITLE = 'Nothing pinned here';
export const NOT_FOUND_BODY =
  'This address doesn’t point at anything — the dust moves things around out here. Find your way back from the graph.';

/** The `errorElement`'s copy: something below the boundary threw. */
export const ROUTE_CRASH_TITLE = 'This screen hit something it couldn’t clear';
export const ROUTE_CRASH_BODY =
  'Reloading usually fixes it. If it keeps happening, come back in a bit.';

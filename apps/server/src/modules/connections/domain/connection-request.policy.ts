/**
 * How long a connection request stays answerable (issue #206, ADR-0018 D5).
 *
 * ⚠ **Fourteen days, evaluated at read and decide time, never written to a row.** There is
 * no `expired` status and no cron: every read filters on `created_at`, and the gated
 * update carries the same predicate, so a lapsed request is gone the instant it lapses
 * rather than the next time a job runs. A stored state would be wrong for exactly as long
 * as that job was behind, and "wrong" here means an owner accepting a request the rules
 * say has already gone — which creates a connection out of consent that expired.
 *
 * It is a limit rather than a use count on purpose. The rejected alternative was an
 * "N uses" link (issue #206): invisible remaining-use state, and it keeps the
 * auto-connect-for-holder model the whole feature exists to retire.
 */
export const CONNECTION_REQUEST_TTL_DAYS = 14;

/**
 * How many requests may be waiting on one owner at once.
 *
 * The load-bearing abuse control, and the reason it is a *pending* cap rather than a total:
 * an owner who answers their inbox is never blocked, and an owner who does not is not
 * flooded. Requests that have lapsed do not count — they are already gone by
 * {@link CONNECTION_REQUEST_TTL_DAYS}, so the cap cannot become permanent through
 * abandonment.
 *
 * 32 is chosen to sit above any plausible honest burst (a link read out at a gathering)
 * and far below a useful flood. It is not a scarcity signal and must never be shown to a
 * requester as one: a full inbox answers the same refusal an unknown slug does
 * ({@link import('./personal-link.errors').PersonalLinkUnavailableError}).
 */
export const PENDING_CONNECTION_REQUEST_CAP = 32;

/** How many requests one link may produce inside {@link CONNECTION_REQUEST_RATE_WINDOW_MINUTES}. */
export const CONNECTION_REQUEST_RATE_LIMIT = 12;

/** The rolling window {@link CONNECTION_REQUEST_RATE_LIMIT} is counted over. */
export const CONNECTION_REQUEST_RATE_WINDOW_MINUTES = 60;

const MILLISECONDS_PER_MINUTE = 60_000;
const MILLISECONDS_PER_DAY = 24 * 60 * MILLISECONDS_PER_MINUTE;

/**
 * The `created_at` floor a request must be **strictly after** to still be live.
 *
 * Returned as a value the caller binds into its statement rather than as SQL, so the
 * arithmetic has one home and the integration tests can pin it by passing a fixed clock.
 *
 * @param now - The reading moment. Supplied rather than read here, so the domain holds no
 *   clock (addendum §12) and a test can place a request either side of the boundary.
 */
export function liveRequestFloor(now: Date): Date {
  return new Date(now.getTime() - CONNECTION_REQUEST_TTL_DAYS * MILLISECONDS_PER_DAY);
}

/**
 * The `created_at` floor of the rate-limit window.
 *
 * ⚠ **Counted over every status, not just `pending`.** A burst that was declined as fast
 * as it arrived still consumed the link's recent budget — otherwise declining is how an
 * attacker resets it, and the owner's own diligence becomes the flood's fuel.
 */
export function rateWindowFloor(now: Date): Date {
  return new Date(now.getTime() - CONNECTION_REQUEST_RATE_WINDOW_MINUTES * MILLISECONDS_PER_MINUTE);
}

/**
 * Has this request lapsed?
 *
 * ⚠ **Boundary-inclusive on the floor**, matching the `created_at > floor` predicate every
 * statement uses: a request created exactly at the floor has lapsed. The two spellings have
 * to agree, or a request would be live to one reader and gone to another — so this function
 * exists to be the second spelling, tested against the first.
 *
 * @param createdAt - When the request was written.
 * @param now - The deciding moment.
 */
export function hasLapsed(createdAt: Date, now: Date): boolean {
  return createdAt.getTime() <= liveRequestFloor(now).getTime();
}

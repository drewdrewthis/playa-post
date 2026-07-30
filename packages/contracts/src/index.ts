/**
 * Public cross-boundary contracts for Playa Post.
 *
 * This barrel is the ONLY surface `apps/web` may import from the server side of
 * the system (boundary rule `no-web-to-server-internals`, addendum §19). It is
 * deliberately empty in M1: nothing has been promoted to a shared contract yet,
 * and the addendum forbids creating abstractions before a real cross-runtime
 * dependency exists (§3, §4).
 *
 * See `packages/contracts/README.md` for ownership and the promotion rule.
 */

export {};

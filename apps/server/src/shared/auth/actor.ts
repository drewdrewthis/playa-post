/**
 * A verified Supabase auth identity, before it has been matched to a product user.
 *
 * This is what a valid access token proves and nothing more: *someone* signed in.
 * Whether that someone has completed onboarding — has a row in `app.users` with a
 * handle — is a separate question, answered by an {@link import('./actor-resolver').ActorResolver}.
 *
 * Keeping the two apart is what makes `ONBOARDING_REQUIRED` expressible at all
 * (M2-AC2): collapse them and a signed-in user without a product row is
 * indistinguishable from a forged token.
 */
export interface AuthenticatedPrincipal {
  /**
   * `auth.users.id` from the token's `sub` claim.
   *
   * ADR-0008 rule 2: the **only** bridge between Supabase Auth and the product, and
   * deliberately not a cross-schema foreign key. Never use it as a product
   * identifier — every product FK points at `app.users.id` (rule 1).
   */
  readonly authUserId: string;
}

/**
 * An onboarded product user, resolved once per request at the tRPC context boundary.
 *
 * ADR-0008 rule 8: application services receive an `Actor` — never a JWT, never a
 * Supabase client, never the raw `auth_user_id`. That is the whole point of resolving
 * here: past this boundary, "who is asking" is a value, not a credential to re-verify.
 *
 * Deliberately minimal. Anything else about the user (status, display name, contact
 * fields) is a read the owning module performs under its own authorization rules —
 * putting it here would make every service a consumer of identity's internals
 * (addendum §19).
 */
export interface Actor {
  /** `app.users.id` — internal, immutable, never reused (ADR-0008 rule 1). */
  readonly userId: string;
  /** The user's chosen handle. Immutable in v1 (ADR-0008 rule 4). */
  readonly handle: string;
}

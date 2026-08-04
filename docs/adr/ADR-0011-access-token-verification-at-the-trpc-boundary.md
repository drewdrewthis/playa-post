# ADR-0011 — Access-token verification at the tRPC boundary

- **Status:** proposed
- **Date:** 2026-08-04
- **Drivers:** ADR-0008 rule 8 ("verify the Supabase JWT" — without saying how), ADR-0002 §2 and §5a,
  addendum §15, §18, §24; implementation plan M2.2, M2-AC2

## Context

ADR-0008 rule 8 fixes *where* authentication happens — once, at the tRPC context boundary, mapping
`auth_user_id → app.users.id` and handing application services an `Actor` — and says nothing about
*how* the token is verified. That gap is not cosmetic. Three sub-decisions live in it, and each has a
plausible wrong answer that no existing gate would catch:

1. **Symmetric secret or asymmetric JWKS.** Supabase issues end-user access tokens signed either with
   the project's shared HS256 secret or, under its asymmetric-keys model, with a rotating key pair
   published at `/auth/v1/.well-known/jwks.json`.
2. **Which client library.** The M2 lane brief lists `@supabase/supabase-js` among L0's adoptions.
3. **Which claims are actually asserted.** The dangerous default is "the signature verified, therefore
   this is a user" — which is false on this platform.

(3) is the one that bites. **Supabase signs the `anon` and `service_role` API keys with the same
secret as user tokens.** A verifier that checks only the signature accepts `service_role` — the
credential ADR-0002 §2 says must never reach this system — as an authenticated session. The keys are
distinguishable only by their claims.

## Decision

**Verify locally with `jose` against the project's HS256 secret, and assert four claim properties, not
one. No Supabase client on the server.**

Implemented as `createSupabaseJwtVerifier` in `apps/server/src/shared/auth/supabase-jwt-verifier.ts`,
behind the `AccessTokenVerifier` port so `domain/` and `application/` depend on the interface and never
on a JWT library (addendum §2).

Asserted, all four:

| Assertion | What it stops |
|---|---|
| `algorithms: ['HS256']` | Algorithm confusion — a token re-headered `alg: none` or `RS256`, rejected before any key is consulted |
| `audience: 'authenticated'` | A token the project issued for something other than a user session |
| `requiredClaims: ['sub', 'exp']` | A credential with no expiry; a token with nobody to be |
| `role === 'authenticated'` | **The `anon` and `service_role` keys**, both signed with this exact secret |

Two further rules:

- **Every failure is one error.** `AccessTokenVerificationError`, one message, no discriminator. The
  caller learns "no", never which check said so — ADR-0002 §10's indistinguishability rule applied to
  the auth boundary, so it cannot be used as an oracle to tune a forgery against.
- **Clock tolerance defaults to 0.** A tolerance is a window in which a revoked session still works.
  Widen it only against measured skew.

Verification is local: no network call, no JWKS fetch, no third-party availability dependency on the
hot path of every authenticated request.

**`Actor` resolution is a separate port.** `AccessTokenVerifier` answers "is this token real"; an
`ActorResolver` answers "is there a product user behind it" and owns the `erased`/`suspended`/
`deactivated` rejections (ADR-0008's lifecycle table). Lane L0 ships the port and a
`createNoOnboardedUsersResolver` that is true rather than fake — `app.users` does not exist yet, so
nobody *is* onboarded. Lane L1 replaces it with `modules/identity`'s query and deletes it.

Splitting them is what makes M2-AC2's three outcomes expressible: 401 for no token, 401 for a bad
token, **403 `ONBOARDING_REQUIRED`** for a good token with no product user. Collapse the two ports and
the third case cannot be told from the second.

## Alternatives considered

| Alternative | Why not (now) |
|---|---|
| **Asymmetric JWKS verification** | Strictly better on one axis: the server holds a public key and cannot mint tokens, so a compromised API host cannot forge a session. Rejected for M2 on cost, not principle — it adds a fetched-and-cached key set, a rotation path, and a network dependency in the request path, to protect against a threat (server compromise) that already loses `DATABASE_URL` and therefore the whole database. **This is the documented migration**, and it is cheap: `jose`'s `createRemoteJWKSet` replaces the key argument inside `createSupabaseJwtVerifier`, and no caller changes. Revisit when the project moves to asymmetric keys or when the secret's blast radius is the binding constraint. |
| **`@supabase/supabase-js` on the server** | It is a data/auth/storage/realtime client for talking *to* Supabase. The server never does: ADR-0002 §1–2 route all product data through `app_rw` and Kysely, and PostgREST cannot reach schema `app` at all. Verifying a JWT needs a verifier, not a client — and `getUser()` would turn a local signature check into a network round trip per request. Adopting it here would be an unused dependency (addendum §4) on the server; `apps/web` adopts it for magic-link sign-in when L5 builds that surface, which is where it belongs. |
| **`jsonwebtoken`** | Callback-first, CJS, and its historical API made `algorithms` optional — the exact default that produced the `alg: none` class of breaks. `jose` is ESM, promise-native, requires the algorithm list, and is already in this workspace via `@playa-post/testing`. |
| **Hand-rolled HMAC verification** | Addendum §18 forbids building a crypto layer without an ADR justifying it, and this would be that ADR arguing against itself. |
| **Trusting a gateway to have verified the token** | There is no gateway. Render routes to this process directly (ADR-0009). |
| **Caching verification results per token** | A token's validity is a function of the clock, and the cache would be the thing that keeps a revoked session alive. HMAC over a short string is not the bottleneck. |

## Consequences

- **Positive:** no network call and no third-party availability dependency on the authenticated path;
  one file knows what a JWT is; the `AccessTokenVerifier` port keeps modules free of it; the L1 seam is
  a one-line container swap.
- **Positive:** the `role` assertion closes a hole that is invisible to every other gate in the repo.
  No boundary rule, type, or migration would have caught a `service_role` key being accepted as a user.
- **Negative — stated plainly:** the server holds a secret that can **mint** tokens, not just verify
  them. Leaking `SUPABASE_JWT_SECRET` is impersonation of every user, and it lives beside
  `DATABASE_URL` in the same secret store. The asymmetric migration above is the answer when that
  becomes the binding risk; until then it is a recorded, accepted exposure, not an oversight.
- **Negative:** one uniform error message makes a genuine misconfiguration (wrong secret in Render)
  present as "all logins fail" with no detail in the response. The cause travels in the error's `cause`
  to the server's own logs, which is where a diagnosis belongs.
- **Reversibility:** high. The port has one implementation and one construction site
  (`composition/container.ts`).

## Verification

`accepted` when:

1. `supabase-jwt-verifier.unit.test.ts` is green, including the `service_role`, `anon`, `alg: none`,
   expired, no-`exp`, no-`sub`, and wrong-audience rejections, and the assertion that all failures are
   indistinguishable;
2. M2-AC2's three `curl` transcripts are captured — 401 no token, 401 tampered token, 403
   `ONBOARDING_REQUIRED` — which lane L1 produces against a real `app.users`;
3. `createNoOnboardedUsersResolver` is deleted in the L1 PR that registers the identity module.

# ADR-0011 — Access-token verification at the tRPC boundary

- **Status:** proposed
- **Date:** 2026-08-04 — **amended the same day**, HS256 shared secret → ES256 via the project JWKS.
  See [Amendment](#amendment--2026-08-04--es256-via-the-project-jwks); the superseded arrangement is
  recorded there rather than deleted.
- **Drivers:** ADR-0008 rule 8 ("verify the Supabase JWT" — without saying how), ADR-0002 §2 and §5a,
  addendum §15, §18, §24; implementation plan M2.2, M2-AC2

## Context

ADR-0008 rule 8 fixes *where* authentication happens — once, at the tRPC context boundary, mapping
`auth_user_id → app.users.id` and handing application services an `Actor` — and says nothing about
*how* the token is verified. That gap is not cosmetic. Three sub-decisions live in it, and each has a
plausible wrong answer that no existing gate would catch:

1. **Symmetric secret or asymmetric JWKS.** Supabase issues end-user access tokens signed either with
   the project's shared HS256 secret or, under its asymmetric-keys model, with a rotating key pair
   published at `/auth/v1/.well-known/jwks.json`. **The live project (`raiemsytiokplvmoqsze`) uses
   asymmetric signing keys, and its legacy HS256 secret is retired** — a fact established after this
   ADR was first written, and the reason for the amendment below.
2. **Which client library.** The M2 lane brief lists `@supabase/supabase-js` among L0's adoptions.
3. **Which claims are actually asserted.** The dangerous default is "the signature verified, therefore
   this is a user" — which is false on this platform.

(3) is the one that bites. **A Supabase project signs credentials that are not people with the same
key material as user sessions** — `anon` and `service_role`, the latter being the one ADR-0002 §2 says
must never reach this system. A verifier that checks only the signature accepts it as an authenticated
session; the credentials are distinguishable only by their claims.

Which key material signs which credential is Supabase's to change, and it did: the legacy `anon` and
`service_role` JWTs are signed with the retired HS256 secret, so the algorithm pin below happens to
refuse them a second time. That is defence in depth, not grounds for dropping the claim check — the
claim check is the assertion that does not depend on a platform detail outside this repository.

## Decision

**Verify with `jose` against the project's published signing keys — ES256, resolved through
`/auth/v1/.well-known/jwks.json` — and assert four claim properties, not one. No Supabase client on
the server.**

Implemented as `createSupabaseJwtVerifier` in `apps/server/src/shared/auth/supabase-jwt-verifier.ts`,
behind the `AccessTokenVerifier` port so `domain/` and `application/` depend on the interface and never
on a JWT library (addendum §2).

Asserted, all four:

| Assertion | What it stops |
|---|---|
| `algorithms: ['ES256']` | Algorithm confusion — a token re-headered `alg: none`, `RS256`, or `HS256` (the retired arrangement), rejected **before any key is consulted** |
| `audience: 'authenticated'` | A token the project issued for something other than a user session |
| `requiredClaims: ['sub', 'exp']` | A credential with no expiry; a token with nobody to be |
| `role === 'authenticated'` | **The `anon` and `service_role` credentials** — a verified signature proves the project minted the token, not that a person is behind it |

Three further rules:

- **The key source is injected, never constructed here.** The verifier takes a `jose` key source — a
  `JWTVerifyGetKey` or a single public key. `composition/container.ts` builds the production one,
  `createRemoteJWKSet(supabaseJwksUrl(configuration.supabaseUrl))`, **once per process**: `jose` caches
  the fetched key set and rate-limits refetches, so a per-request construction would discard the cache
  and make Supabase's JWKS endpoint a hard dependency of every authenticated call. Constructing it
  opens no socket, which is what keeps `buildAppContainer` free of I/O. A unit test injects a key pair
  generated in-process and never touches the network — the seam exists for correctness of the
  composition root first, and testability follows from it.
- **Every failure is one error.** `AccessTokenVerificationError`, one message, no discriminator. The
  caller learns "no", never which check said so — ADR-0002 §10's indistinguishability rule applied to
  the auth boundary, so it cannot be used as an oracle to tune a forgery against. Under a key set this
  now also covers "no published key matches this `kid`", which would otherwise be a free key-id
  enumeration oracle.
- **Clock tolerance defaults to 0.** A tolerance is a window in which a revoked session still works.
  Widen it only against measured skew.

**This server holds no signing capability.** It has public key material and nothing else, so
compromising the API host cannot forge a session. The cost is a dependency on the key source: the
first token after a cold start, or after a rotation introduces an unseen `kid`, pays one HTTPS fetch;
every other request is local.

`SUPABASE_URL` — the project's base API URL — is the only configuration this needs. It is **not a
secret**: a project ref is a public identifier, so it lives in `render.yaml` with its value rather than
behind `sync: false`. It is still required and undefaulted, because it decides *whose* users this
server accepts and a wrong-but-plausible default would fail by working.

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
| **Symmetric HS256 shared secret** | What this ADR originally decided, and what shipped in [#19](https://github.com/drewdrewthis/playa-post/pull/19). Rejected on **fact, not preference**: the live project signs with asymmetric keys and its HS256 secret is retired, so an HS256 verifier rejects every token a real user presents. It was also strictly worse on blast radius — a shared secret can *mint* tokens, so leaking it is impersonation of every user. Recorded in full under [Amendment](#amendment--2026-08-04--es256-via-the-project-jwks). |
| **Pinning a public key in configuration instead of fetching the key set** | Removes the network dependency and keeps the "no signing capability" property. Rejected because it turns every key rotation into a deploy, and a rotation missed is a total auth outage with no signal until it happens. `createRemoteJWKSet` follows a rotation by itself: an unrecognised `kid` is what triggers a refresh. The verifier still *accepts* a bare public key, so this stays a one-line change in `container.ts` if the JWKS endpoint's availability ever becomes the binding constraint. |
| **`@supabase/supabase-js` on the server** | It is a data/auth/storage/realtime client for talking *to* Supabase. The server never does: ADR-0002 §1–2 route all product data through `app_rw` and Kysely, and PostgREST cannot reach schema `app` at all. Verifying a JWT needs a verifier, not a client — and `getUser()` would turn a local signature check into a network round trip per request. Adopting it here would be an unused dependency (addendum §4) on the server; `apps/web` adopts it for magic-link sign-in when L5 builds that surface, which is where it belongs. |
| **`jsonwebtoken`** | Callback-first, CJS, and its historical API made `algorithms` optional — the exact default that produced the `alg: none` class of breaks. `jose` is ESM, promise-native, requires the algorithm list, and is already in this workspace via `@playa-post/testing`. |
| **Hand-rolled signature verification** | Addendum §18 forbids building a crypto layer without an ADR justifying it, and this would be that ADR arguing against itself. More so now: it would mean hand-rolling ECDSA *and* JWKS selection. |
| **Trusting a gateway to have verified the token** | There is no gateway. Render routes to this process directly (ADR-0009). |
| **Caching verification results per token** | A token's validity is a function of the clock, and the cache would be the thing that keeps a revoked session alive. One P-256 verification over a short string is not the bottleneck; the key set is already cached, which is the part that would have been. |

## Consequences

- **Positive:** the server can verify a session but cannot mint one. There is no credential in the
  deploy whose leak impersonates every user, and one fewer secret in Render's store than before.
- **Positive:** key rotation is a non-event. Supabase can retire a signing key without a deploy here;
  an unrecognised `kid` triggers a refresh of the cached set.
- **Positive:** the `role` assertion closes a hole that is invisible to every other gate in the repo.
  No boundary rule, type, or migration would have caught a `service_role` credential being accepted as
  a user.
- **Positive:** one file knows what a JWT is; the `AccessTokenVerifier` port keeps modules free of it;
  the L1 seam is a one-line container swap.
- **Negative — stated plainly:** the authenticated path now has a third-party availability dependency.
  If Supabase's JWKS endpoint is unreachable *and* the cache is cold or the `kid` is unseen, every
  authenticated request fails. `jose`'s cache keeps that to the first request after a cold start or a
  rotation rather than a per-request risk, and the failure is fail-closed. Accepted deliberately:
  Supabase Auth being down means users cannot obtain a token either, so the outage is not one this
  server could have been available through.
- **Negative:** one uniform error message makes a genuine misconfiguration — a wrong `SUPABASE_URL`,
  or a JWKS endpoint 404 — present as "all logins fail" with no detail in the response. The cause
  travels in the error's `cause` to the server's own logs, which is where a diagnosis belongs, and
  `supabaseJwksUrl` has its own unit test precisely because that string cannot be debugged from the
  outside.
- **Reversibility:** high. The port has one implementation and one construction site
  (`composition/container.ts`), and the key source is an argument — pinning a public key instead of
  fetching a set is a one-line change there.

## Verification

`accepted` when:

1. `supabase-jwt-verifier.unit.test.ts` is green, including the `service_role`, `anon`, **`HS256`**,
   `alg: none`, expired, no-`exp`, no-`sub`, wrong-audience, wrong-key, and **unknown-`kid`**
   rejections; the assertion that all failures are indistinguishable; and the assertion that a
   disallowed algorithm is refused **without the key source being consulted**, so a forged header
   cannot make this process issue an outbound request;
2. `supabase-jwks-url.unit.test.ts` is green, pinning the endpoint the key set is fetched from;
3. M2-AC2's three `curl` transcripts are captured — 401 no token, 401 tampered token, 403
   `ONBOARDING_REQUIRED` — which lane L1 produces against a real `app.users`;
4. `createNoOnboardedUsersResolver` is deleted in the L1 PR that registers the identity module.

Rows 3 and 4 are L1's to produce, so this ADR stays `proposed` until then — see `docs/adr/README.md`
for what the status means. The amendment below did not change that bar; it changed what row 1 asserts.

## Amendment — 2026-08-04 — ES256 via the project JWKS

**What changed.** Verification moved from the project's shared HS256 secret to ES256 against the keys
published at `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`. `SUPABASE_JWT_SECRET` is gone from the
configuration schema, `.env.example`, and the Render blueprint; `SUPABASE_URL` replaces it.

**Why.** The live project signs access tokens with asymmetric signing keys, and its legacy HS256
secret is marked `previously_used` — dead. The original decision was not merely suboptimal, it was
**wrong about the platform**: an HS256 verifier would have rejected every token a real user presented.

The original text carried an "Asymmetric JWKS verification" alternative that called this "the
documented migration" and predicted its cost exactly — "`createRemoteJWKSet` replaces the key argument
inside `createSupabaseJwtVerifier`, and no caller changes", which is what happened. What it got wrong
was the *trigger*: it assumed the move would be forced by the shared secret's blast radius, and
budgeted for it as a later hardening step. It was forced instead by the project's actual
configuration, on day one. That row is gone from the table above, replaced by the symmetric option it
displaced.

**What did not change.** The four assertions, the single uniform error, `clockTolerance: 0`, the
`AccessTokenVerifier` port, the `ActorResolver` split, and the absence of `@supabase/supabase-js` on
the server. The verifier's shape is the same; its key argument is not.

**Honest record.** The HS256 implementation shipped in [#19](https://github.com/drewdrewthis/playa-post/pull/19)
and lived less than a day. It was never exercised against the live project — had it been, the
mismatch would have surfaced immediately. The lesson is cheap and worth writing down: a decision
between two arrangements a platform *supports* is not a judgement call when the platform has already
picked one. Check which is live before weighing the trade-off.

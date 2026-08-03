# ADR-0010 — A purpose-built PostgREST harness for the Supabase-shaped security rows

- **Status:** proposed
- **Date:** 2026-08-03
- **Drivers:** [ADR-0002](ADR-0002-authorization-and-visibility-enforcement.md) B2 (and later B16);
  implementation plan **M1b.3**; `docs/engineering/m2-lane-briefs.md` §"M1b.3 / B2 — its own work item,
  and the biggest hidden cost in M2"; addendum §18 (proven libraries over custom infrastructure),
  §21 (prefer observable behaviour and state)

## Context

ADR-0002's bypass suite is the compensating control for a database that will never catch a missing
`WHERE viewer_id`. Sixteen of its eighteen rows are assertable, eventually, against the existing
harness: `startPostgresTestDatabase()` boots `postgres:17`, applies `supabase/migrations`, and hands
back a connection. B1, B3 and B4 already run that way.

**B2 cannot.** Its assertion is *"hit the Supabase REST endpoint for each `app` table with a valid user
JWT → 404/`PGRST106`"*. There is no REST endpoint in a bare Postgres container, no JWT issuer, and no
`role`-claim dispatch. The row's own manifest entry said so and refused the cheap way out:

> Needs a running PostgREST and a signed user JWT. The Testcontainers harness boots Postgres alone —
> there is no REST layer to call, and asserting the config file instead would prove the setting, not
> the behaviour.

The lane brief flagged this as L0's biggest hidden cost and asked for a decision between two stacks
before L1 starts. This ADR is that decision.

What B2 is actually defending is narrow and worth stating precisely: `supabase/config.toml` sets
`[api] schemas = ["public", "graphql_public"]`, and `app` is deliberately absent. Adding one string to
that list — in the file, or out-of-band through the Supabase dashboard — hands every authenticated
client direct table access and bypasses every visibility function the product will ever write. It is a
one-token change with no compile error, no type error, and no boundary-rule violation.

## Decision

**Run a purpose-built pair — Supabase's own PostgREST image over the existing Testcontainers Postgres
— started with the schema list read from `supabase/config.toml`, and mint the JWTs in-process. Do not
run the Supabase CLI stack, and do not run GoTrue.**

Three parts, each load-bearing:

### 1. The exposure list is an input to the server, never the subject of an assertion

`readSupabaseApiConfiguration()` parses `[api] schemas` and that value becomes PostgREST's
`db-schemas`. Nothing asserts the parsed value. The direction is what makes the row honest: adding
`"app"` to `config.toml` does not fail a string compare — it changes what the server serves, and B2's
behavioural assertions go red because product tables become reachable. That is the only reading of
"catalog-driven, so a newly exposed schema fails" worth having.

### 2. The harness mints its own tokens

PostgREST verifies an HS256 token against a shared secret and reads the `role` claim. It cannot tell,
and has no way to ask, whether GoTrue produced that token. Running an auth server, its schema, and a
mail catcher to obtain a string that `jose` produces in four lines would add moving parts to a security
control without adding a property the control asserts.

The secret is generated per run by `generateJwtSigningSecret()` and never written down. A checked-in
test JWT secret is a checked-in secret — `secret-scan` would be right to flag it, and addendum §17 does
not carve out "but it only guards a throwaway container".

### 3. Every denial is bracketed by a control, on both sides

Each B2 assertion has the shape *"the request did not succeed"*, and requests fail for many boring
reasons. Two of them are live traps we measured rather than imagined:

- PostgREST refuses to build its schema cache if **any** listed schema is missing, then answers every
  request `503 PGRST002` forever. `graphql_public` does not exist in a bare Postgres, so the naive
  harness is exactly this shape. The stack therefore creates missing exposed schemas, waits on the
  *schema-cache* log line rather than the port, and refuses to return an endpoint that is not serving.
- A mis-signed or malformed token yields `401`, which reads like a denial to a "not 200" assertion.

So the suite proves it can reach a table, with this token, over this connection, *before* asserting any
denial — and closes the other side with an **installed falsification**: a second PostgREST over the same
database, same token, with `app` deliberately added to `db-schemas`. It answers `403 / 42501
permission denied for schema app`, not `PGRST106`. The difference is what makes `PGRST106` attributable
to non-exposure rather than to a broken harness.

That control also earns a second finding for free: exposure alone is **not** a breach. The request gets
past the schema gate and is stopped by ADR-0002 §3's revoke set, which shows §1 and §3 are two
independent lines rather than one control counted twice.

### Cost, and what it does not cost

Three containers at peak (Postgres, PostgREST, and the control's second PostgREST), inside the existing
`test:security` job. **No new CI job, no Supabase CLI in `setup-workspace`, no compose file, no
change to `.github/workflows/ci.yml`.** The image comes from AWS public ECR, which has no anonymous
pull-rate limit, so the security job does not inherit Docker Hub's.

## Alternatives considered

| Alternative | Why not |
|---|---|
| **The Supabase CLI stack (`supabase start`) in CI** | Ten containers — Kong, GoTrue, PostgREST, Realtime, Storage, imgproxy, postgres-meta, Studio, Mailpit, edge-runtime — to assert one property about one of them, plus a CLI install in `setup-workspace` and a new job shape. PR #13 rejected the same trade for the type-drift check ("eight containers and a new job") and substituted the existing Testcontainers harness; this is that precedent applied again. It also couples a required check to the CLI's whole release surface: any of those ten images changing can redden a security control for a reason unrelated to security. |
| **PostgREST + GoTrue as a container pair** | GoTrue's only contribution is *issuing* the token, and PostgREST cannot distinguish its output from a locally-signed one. Buying that indistinguishable string costs a container, the `auth` schema and its migrations, and a sign-up flow on the critical path of a security control. What actually needs proving — that the token is genuinely accepted — is proven behaviourally by the positive control, which is strictly stronger evidence than provenance. Revisit if a future row asserts something about **auth itself** (token lifetime, refresh rotation, `aud` enforcement); that would be GoTrue's own behaviour and would deserve it. |
| **Upstream `postgrest/postgrest` image** | Not the binary a Supabase project serves. Pulls from Docker Hub, whose anonymous rate limit lands on a *required* check. |
| **Assert `supabase/config.toml` instead** | The manifest rejected this before the work started, and it is the same failure shape as asserting an IAM policy document instead of calling the API: it proves the setting, not the behaviour. A setting can be correct in the file and overridden out-of-band in the Supabase dashboard — which is precisely the drift B18 exists for. |
| **Reuse the `startPostgresTestDatabase()` container for both suites** | The harness provisions platform roles (`service_role`, an authenticator) and a probe table in `public`. Keeping that out of the container B1/B3/B4 assert against means those rows never have to reason about harness artefacts. Two Postgres boots in one serialised job is a cheap price for that isolation. |
| **A `network-mode: host` or `host-gateway` sidecar, to avoid touching the shared harness** | Saves ~15 lines and silently fails on rootless Docker and Podman. A shared Testcontainers network is the supported mechanism. |

## Consequences

- **Positive:** B2 flips from `pending` to `live` with no CI-shape change; the pattern generalises to the
  other Supabase-surface rows (B16, storage) without re-litigating the stack; and the exposure control
  means the suite carries its own falsification rather than relying on a transcript captured once.
- **Positive:** `jose` and `smol-toml` enter the workspace as test dependencies only. M2.2's runtime
  adoption of `jose` for JWT *verification* is untouched by this and remains its decision to make.
- **Negative — the pin is manual.** `POSTGREST_TEST_IMAGE` must track the Supabase CLI's PostgREST. The
  CLI does not publish its image map in any form a test can read, so unlike `POSTGRES_TEST_IMAGE` ↔
  `db.major_version` there is no unit test holding the two together. It is a comment and a habit, which
  is weaker, and it is stated here rather than hidden.
- **Negative — B2 is Docker-gated**, like B1/B3/B4 before it. Accepted on the same grounds: `test:security`
  is one of the nine unconditionally-required CI jobs, not an opt-in gate, so the gate is genuinely the
  floor rather than a way of avoiding one.
- **Negative — this proves the migrations, not the deployed project.** A Supabase dashboard user can add
  `app` to the exposed schemas of the live project and every assertion here stays green. That gap is
  ADR-0002 **B18**'s, is already declared `pending until M4`, and this ADR does not close it.

## Verification

Shown by the PR that introduces this ADR:

- `tests/security/postgrest-schema-exposure.security.test.ts` is `provenBy` for B2 in
  `b-rows.manifest.json`, and `b-row-manifest.security.test.ts` pins the live list to `B1, B2, B3, B4` —
  so the row cannot be promoted by editing JSON.
- A falsification transcript in `.github/evidence/`: with `"app"` added to `[api] schemas`, the B2
  assertions go red; with the harness's positive control removed, the suite is shown to pass against a
  server that is not serving.

Owed later:

- B18 covers the live-project drift this ADR explicitly does not (M4).
- B16 (storage) is the next row on this surface; it should extend this stack rather than introduce a third.

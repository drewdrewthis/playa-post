# Architecture Decision Records

Format: MADR-ish short form — Context / Decision / Alternatives / Consequences / Verification.

`Status: proposed` means the decision is the working default and implementation may proceed on it,
but it is not yet proven by running code. It becomes `accepted` when the Verification section's
evidence exists in the repo or in CI. `superseded by ADR-NNNN` when replaced.

One exception, named rather than left implicit: an ADR recording a **product-owner decision** is
`accepted` on that authority, because the choice was never the team's to prove — only its execution is.
Such an ADR still carries a Verification section, split into what the introducing PR shows and what a
later milestone must. ADR-0009 is the only one so far.

| ADR | Title | Status |
|-----|-------|--------|
| [0001](ADR-0001-runtime-and-deployment-target.md) | Runtime and deployment target (Cloudflare Worker vs Node on Railway) | superseded by [0009](ADR-0009-deploy-node-server-to-render.md) |
| [0002](ADR-0002-authorization-and-visibility-enforcement.md) | Authorization and visibility enforcement strategy | Accepted (revised — core decision endorsed by stress test; bar is now B1–B18) |
| [0003](ADR-0003-dependency-injection.md) | Dependency injection via explicit factory composition | proposed |
| [0004](ADR-0004-graph-traversal-and-visibility-queries.md) | Graph traversal and visibility queries | proposed |
| [0005](ADR-0005-offline-sync-protocol.md) | Offline sync protocol, idempotency, and conflict rules | proposed (amended — cross-module handlers write `mutation_results` in a separate transaction after the owning module's commit; accepted duplicate-effect window for non-idempotent handlers, tracked pending a cross-module unit-of-work seam) |
| [0006](ADR-0006-outbox-and-queue-delivery.md) | Transactional outbox and asynchronous delivery | proposed |
| [0007](ADR-0007-board-query-dsl.md) | Board query DSL — restricted validated grammar | proposed |
| [0008](ADR-0008-identity-model.md) | Identity model — auth user ↔ internal ID | proposed (amended — the confusable-normalization algorithm named; `HANDLE_TOO_SHORT` beside `HANDLE_TOO_LONG`) |
| [0009](ADR-0009-deploy-node-server-to-render.md) | Deploy the Node server to Render (supersedes 0001) | accepted — owner decision 2026-08-02 |
| [0010](ADR-0010-supabase-rest-security-harness.md) | A purpose-built PostgREST harness for the Supabase-shaped security rows (ADR-0002 B2) | proposed |
| [0011](ADR-0011-access-token-verification-at-the-trpc-boundary.md) | Access-token verification at the tRPC boundary (how ADR-0008 rule 8 is implemented) | proposed (amended — ES256 via the project JWKS, superseding the HS256 shared secret; `signedInProcedure` added, Verification row 4 done; authentication resolves lazily so a public procedure touches no dependency) |
| [0012](ADR-0012-connection-trust-and-person-projection.md) | Connection trust storage, the §6a person projection's export, and lane L2's amendments (amends 0002, 0004, 0006) | proposed — **trust-row model pending owner confirmation** |
| [0013](ADR-0013-bulletin-visibility-and-the-board-grammar-split.md) | Bulletin visibility, `BULLETIN_GONE`, and the board grammar's parse/compile split (amends 0002, 0005, 0007) | proposed |
| [0014](ADR-0014-contracts-api-spec-and-router-parity.md) | `packages/contracts` declares the client API; a compile-time parity gate keeps it honest | proposed |
| [0015](ADR-0015-design-tokens-theming-and-self-hosted-type.md) | Two token sets, an explicit theme toggle, and self-hosted type | proposed (amended — three-way preference incl. system mode, dark default per issue #151, superseding #43's light default) |
| [0016](ADR-0016-saved-views-and-the-notify-me-designation.md) | Saved views, and the per-view bell as a designation rather than a notify flag (implements 0007's `app.saved_views`; executed product decision D1, and **amended in place for D16** — several bells may be lit at once, so the constraint carrying the rule is `unique nulls not distinct (owner_id, source_view_id)` rather than a primary key on `owner_id`) | proposed |
| [0017](ADR-0017-intro-requests-and-the-consent-inversion.md) | Intro requests: their own aggregate, eligibility composed on both sides, and the consent inversion (amends 0002, 0004) | proposed |

Normative inputs, in precedence order:

1. `docs/engineering/architecture-addendum.md`
2. `docs/Burner_Trust_Network_Final_Handoff.pdf`
3. `docs/product/decisions.md`
4. `design/Playa Post.dc.html` (product evidence only — not architecture)

Also normative, on a different axis: `docs/product/launch-definition-of-done.md` defines when v1 is done.

ADR-0002 was stress-tested on 2026-07-30
(`docs/engineering/reviews/2026-07-30-adr-0002-stress-test.md`, verdict *sound-with-changes*). Its core
decision — application-layer authorization as the mechanism, database privileges as a blast door — was
endorsed and **should not be reopened**; the revision hardened the policy shape and grew the bypass suite
from B1–B12 to **B1–B18**. Read that review before proposing changes to ADR-0002.

New ADR: copy the section headings from any file above, take the next number, open as `proposed`.
Per addendum §18, any custom infrastructure requires an ADR naming why hardened options are insufficient.

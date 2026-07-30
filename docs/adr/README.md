# Architecture Decision Records

Format: MADR-ish short form — Context / Decision / Alternatives / Consequences / Verification.

`Status: proposed` means the decision is the working default and implementation may proceed on it,
but it is not yet proven by running code. It becomes `accepted` when the Verification section's
evidence exists in the repo or in CI. `superseded by ADR-NNNN` when replaced.

| ADR | Title | Status |
|-----|-------|--------|
| [0001](ADR-0001-runtime-and-deployment-target.md) | Runtime and deployment target (Cloudflare Worker vs Node on Railway) | proposed |
| [0002](ADR-0002-authorization-and-visibility-enforcement.md) | Authorization and visibility enforcement strategy | proposed |
| [0003](ADR-0003-dependency-injection.md) | Dependency injection via explicit factory composition | proposed |
| [0004](ADR-0004-graph-traversal-and-visibility-queries.md) | Graph traversal and visibility queries | proposed |
| [0005](ADR-0005-offline-sync-protocol.md) | Offline sync protocol, idempotency, and conflict rules | proposed |
| [0006](ADR-0006-outbox-and-queue-delivery.md) | Transactional outbox and asynchronous delivery | proposed |
| [0007](ADR-0007-board-query-dsl.md) | Board query DSL — restricted validated grammar | proposed |
| [0008](ADR-0008-identity-model.md) | Identity model — auth user ↔ internal ID | proposed |

Normative inputs, in precedence order:

1. `docs/engineering/architecture-addendum.md`
2. `docs/Burner_Trust_Network_Final_Handoff.pdf`
3. `docs/product/decisions.md`
4. `design/Playa Post.dc.html` (product evidence only — not architecture)

New ADR: copy the section headings from any file above, take the next number, open as `proposed`.
Per addendum §18, any custom infrastructure requires an ADR naming why hardened options are insufficient.

# AC index — every acceptance criterion mapped to its proof

Generated reference, per `docs/engineering/repo-map.md`: each AC from
`docs/engineering/implementation-plan.md` maps to the CI job (or manual procedure) that proves
it, and the file where that proof lives. CI fails if an AC in the plan has no row here
(addendum §25). Add a row in the same PR that lands the AC's proof.

| AC | CI job | Proof | Notes |
|---|---|---|---|
| M2-AC1 (slice, end to end) | `test:e2e` | `tests/e2e/vertical-slice-e2e.spec.ts` | Step 9 red pending [#31](https://github.com/drewdrewthis/playa-post/issues/31) |
| M2-AC15 (composition assertion, B12) | `test:security` | `composition-assertion.security.test.ts` | |
| M2-AC16 (log hygiene) | `test:integration` | `tests/integration/vertical-slice-log-hygiene.integration.test.ts` | |
| M2-AC20 (viewerId provenance, B14) | `test:security` | `viewer-id-provenance.security.test.ts` | |
| M2-AC26 (regression) | `lint:boundaries` | `b-rows.manifest.json` | Also covered by `test:security`'s manifest check |
| M5-B1a (multi-hop reach + who-can-see-you radius) | `test:integration` | `modules/identity/tests/integration/visible-to-distance.integration.test.ts` | Degree ≥2 reach; absence-not-anonymity beyond a person's own limit; service round-trip. Ghost surrogate IDs remain open ([ADR-0004] decision 4 deviation, recorded in migration 20260809140000) |
| Bulletin post types ([#87](https://github.com/drewdrewthis/playa-post/issues/87)) | `test:integration` | `modules/bulletins/tests/integration/bulletin-post-types.integration.test.ts` | Six postable types round-trip; `type:` filter narrows; `update`/`note` refused at the write surface. Feature: `specs/features/bulletin-post-types.feature` |

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

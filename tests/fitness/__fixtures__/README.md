# Boundary fixtures

Every directory here is **deliberately broken**. Each one mirrors the real repo
layout (`apps/server/src/modules/…`, `apps/web/src/…`) and commits exactly one
violation of the boundary rule it is named after.

`tests/fitness/boundaries.fitness.test.ts` cruises this tree and asserts:

1. every rule in `.dependency-cruiser.cjs` has a fixture directory named after it;
2. every rule is actually **flagged** by its fixture;
3. no fixture trips a rule other than its own — so a passing test means each rule
   is independently load-bearing, not that some catch-all is firing;
4. the **real** tree (`apps/ packages/`) is clean.

Point 2 is the one that matters. A boundary rule nobody has ever seen fail is a
rule you are trusting on faith — these fixtures are the failing case, kept alive.

## Do not "fix" these files

They are not dead code and they are not a mistake. If a linter, a codemod, or a
well-meaning cleanup pass repairs one of these imports, the corresponding rule
silently stops being tested. They are excluded from ESLint, from `tsc`, and from
`pnpm boundaries` for exactly this reason.

## Adding a rule

1. Add it to `.dependency-cruiser.cjs`.
2. Create `tests/fitness/__fixtures__/<rule-name>/` mirroring the real path shape.
3. Commit the smallest import that violates it — plus whatever file it imports.

Step 1 without steps 2–3 fails the fitness test. That is intentional.

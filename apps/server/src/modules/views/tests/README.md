# `modules/views` tests

Beside the code they test, not in a top-level `tests/` tree: a module's suites move,
split, and get deleted with the module.

**The filename is the price** (`CLAUDE.md`, "Conventions"). `*.unit.test.ts` runs in
the `unit` vitest project — no database, no container, fast enough to run on save.
That is the whole cost of this module today: the grammar is a total function from text
to a validated AST, so there is nothing here that needs infrastructure to prove.

| Directory | Suite | Feature-file scenarios |
|---|---|---|
| `unit/` | `board-query-grammar.unit.test.ts` | `board-visibility-query.feature`'s four `@unit` scenarios — ADR-0007's rejection rule and both sides of the 256-character and 16-term boundaries (M2-AC13) |

The compiler half lives with its SQL, in
`modules/bulletins/persistence/board-filter.ts`: `domain/` may not emit SQL, and the
authorized set the filter narrows is bulletins'. `tests/security/board-query-narrowing.security.test.ts`
carries the B10 proof over that seam — kept in `tests/security/` rather than here
because a B-row must be provable from that tree alone.

# Evidence

Raw terminal captures, recorded with `script -q -e -c '<commands>' <file>`. They are
**unedited** — ANSI escapes, timing noise, and stack traces are all still in them,
because a transcript that has been tidied is a transcript that could have been
written rather than recorded.

| File | What it captures |
|---|---|
| `m1-verification.txt` | Full gate run: install, typecheck, lint, boundaries, all three builds, unit + integration tests, and `depcruise` over the violating fixtures (exit 6, all five rules named). |
| `runtime-both-entrypoints.txt` | Both built bundles actually serving: the Node bundle answering `GET /healthz` over HTTP, the workerd bundle answering the same via its `fetch` handler, and the config loader rejecting a bad `PORT` without echoing its value. |
| `typescript-7-zero-modules.txt` | Ratification of the TypeScript 6.0.3 pin: on TS 7, `pnpm boundaries` reports "no dependency violations found (**0 modules**)" and exits **0** — green while enforcing nothing — and the fitness test's `totalCruised > 0` assertion catches it. |
| `alter-default-privileges-scope.txt` | Why ADR-0002 §3's `ALTER DEFAULT PRIVILEGES` is global rather than `IN SCHEMA app`. The `IN SCHEMA` form parses, reports success, stores **no** catalog row, and leaves a later function `PUBLIC`-executable. The CONTROL section is the falsifying half: with only the schema-scoped rule declared, `public_can_execute` comes back **t**. |
| `security-suite-falsification.txt` | Ten deliberate regressions against `tests/security/`, each observed **red**, then the restored baseline **green**. Covers B1 (grant to `authenticated`), B3 (no `FORCE`, `TO` omitted, `FOR SELECT`, owner drift, no policy at all, and the default-privilege revoke reverted to the broken form), B4 (an unallowlisted `SECURITY DEFINER`), and the B-row gate (a deleted row; a row promoted to `live` with nothing proving it). |
| `db-scripts.txt` | `pnpm db:stop \| db:start \| db:reset` against the real Supabase CLI 2.110.0, then the catalog read-back proving the baseline landed: both roles, `FORCE` RLS, the exact policy row, and the forward guarantee holding on the live stack. The CLI's well-known local demo keys are redacted by the capture script, which says so inline. |

## Reproducing

```bash
script -q -e -c 'pnpm boundaries' /tmp/out.txt
```

An earlier revision of this PR carried a hand-rendered PNG "terminal screenshot".
It was removed: it was an **authored mockup** of output, not a capture of it, and
evidence that was typed rather than recorded is not evidence.

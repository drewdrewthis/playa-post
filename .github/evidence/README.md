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

## Reproducing

```bash
script -q -e -c 'pnpm boundaries' /tmp/out.txt
```

An earlier revision of this PR carried a hand-rendered PNG "terminal screenshot".
It was removed: it was an **authored mockup** of output, not a capture of it, and
evidence that was typed rather than recorded is not evidence.

<!--
  Fill every section below; delete one only where its own comment says you
  may. This encodes CLAUDE.md's "How work ships" step 4, "Prove it" — paste
  real gate output, never a claim — and this repo's `pr-ready-check` review
  tool, which requires the "Human verification" and "How I can prove I was
  successful" headings verbatim, a visual embed or the `no-ui-surface`
  marker below, and a filed issue link for any deferred or follow-up work
  mentioned anywhere in this body.
-->

<!-- backend/infra change with no user-visible surface: leave the marker below in place; delete it if this PR touches anything a user would see. -->
<!-- no-ui-surface -->

## Reviewer cockpit

<!-- Trivial, single-commit, or doc-only PR? Collapse this whole table to one line: **Low risk** — <why>. -->

| | |
|---|---|
| **What** | |
| **Risk** | |
| **Read first** | |
| **Blocks** | |
| **Owner action needed** | |

## Why

<!-- 1-3 sentences. Link the issue: Closes #N. -->

## What changed

<!-- 2-4 bullets, each shaped: **decision** → alternative not taken → consequence/blast-radius. -->

## Acceptance criteria

<!--
  List every AC this PR claims — plan-row IDs (e.g. M1-ACn) and/or an
  issue's own checklist. Check a box only for what "How I can prove I was
  successful" below actually proves: an unproven checkbox is a claim, not
  evidence.
-->

- [ ]

## Definition of done

<!-- Addendum §25 / CLAUDE.md's "Definition of done" most-often-skipped list. Mark a row N/A rather than deleting it when it doesn't apply. -->

- [ ] `pnpm boundaries` passes — module boundaries preserved
- [ ] Authorization enforced server-side (N/A: no new endpoint)
- [ ] Persistence covered by integration tests against real Postgres (N/A: no persistence change)
- [ ] Important state changes emit transactional outbox events (N/A: none)
- [ ] Logs contain no bulletin content or private contact information (N/A: no logging change)
- [ ] Docs/ADRs updated if architecture changed (N/A: no architecture change)

## How I can prove I was successful

<!--
  REQUIRED. Paste actual command output — never a claim that something
  passes. Tag every claim **proven** (exercised this session, evidence
  right below it), **claimed** (asserted, not independently exercised), or
  **missing** (no evidence yet) — claimed/missing is a gap to close before
  marking ready, not a footnote.

  Output too long to paste inline: raw-capture it per
  `.github/evidence/README.md` (`script -q -e -c '<cmd>' .github/evidence/<slug>.txt`)
  and still keep the load-bearing excerpt in this body.
-->

### Gate output

```bash
$ pnpm typecheck
$ pnpm lint
$ pnpm boundaries
$ pnpm build
$ pnpm test
```

## Human verification

<!--
  Concrete numbered steps a skeptical human can follow to independently
  re-verify — not a restatement of the proof above, not a plan. Bug fix:
  repro steps, then the check confirming it no longer reproduces.
-->

1. 

## Anything surprising?

<!--
  Optional — limitations, follow-ups, edge cases a reviewer would
  otherwise miss. Any deferred or follow-up work mentioned here MUST link
  a filed issue (#N or a full github.com/.../issues/N URL) somewhere in
  this body — an unfiled deferral is a blocking gap. "None" is a valid
  answer.
-->
